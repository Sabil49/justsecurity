// services/ScanService.ts
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system/next';
import { Platform } from 'react-native';

export interface ScanFile {
  uri: string;
  name: string;
  size: number;
  path: string;
}

export interface ScanResult {
  file: ScanFile;
  hash: string;
  isThreat: boolean;
  threatName?: string;
  severity?: string;
  category?: string;
}

export interface ScanProgress {
  filesScanned: number;
  totalFiles: number;
  threatsFound: number;
  currentFile?: string;
}

interface HashCheckResult {
  hash: string;
  isThreat: boolean;
  threatName?: string;
  severity?: string;
  category?: string;
}

interface HashCheckResponse {
  results: HashCheckResult[];
}

export type PathSanitizationMode = 'relative' | 'home' | 'filename' | 'hashed' | 'none';

export interface ScanOptions {
  pathSanitization?: PathSanitizationMode;
  root?: string;
  hashSalt?: string;
}

// API client placeholder - replace with your actual API client
const api = {
  post: async <T = any>(endpoint: string, data: any): Promise<{ data: T }> => {
    const response = await fetch(`${process.env.API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { data: await response.json() };
  },
};

class ScanService {
  private readonly BATCH_SIZE = 50;
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private scanPromise: Promise<ScanResult[]> | null = null;
  private scanCancelled = false;

  async quickScan(
    onProgress?: (progress: ScanProgress) => void,
    options?: ScanOptions
  ): Promise<ScanResult[]> {
    return this.performScan('quick', onProgress, options);
  }

  async fullScan(
    onProgress?: (progress: ScanProgress) => void,
    options?: ScanOptions
  ): Promise<ScanResult[]> {
    return this.performScan('full', onProgress, options);
  }

  cancelScan() {
    this.scanCancelled = true;
  }

  private async performScan(
    type: 'quick' | 'full',
    onProgress?: (progress: ScanProgress) => void,
    options?: ScanOptions
  ): Promise<ScanResult[]> {
    if (this.scanPromise) {
      return this.scanPromise;
    }

    this.scanCancelled = false;
   
    this.scanPromise = this.executeScan(type, onProgress, options);
    try {
      return await this.scanPromise;
    } finally {
      this.scanPromise = null;
    }
  }

  private async executeScan(
    type: 'quick' | 'full',
    onProgress?: (progress: ScanProgress) => void,
    options?: ScanOptions
  ): Promise<ScanResult[]> {
    const startTime = Date.now();
    const results: ScanResult[] = [];
    let threatsFound = 0;

    try {
      const filesToScan = await this.getFilesToScan(type);
      const totalFiles = filesToScan.length;

      for (let i = 0; i < filesToScan.length; i += this.BATCH_SIZE) {
        if (this.scanCancelled) {
          throw new Error('Scan cancelled by user');
        }

        const batch = filesToScan.slice(i, i + this.BATCH_SIZE);
        
        const hashes = await Promise.all(
          batch.map(file => this.hashFile(file))
        );

        const hashCheckResults = await api.post<HashCheckResponse>('/scan/hash-check', {
          hashes: hashes.map(h => h.hash),
          deviceId: await this.getDeviceId(),
        });

        for (let j = 0; j < batch.length; j++) {
          const file = batch[j];
          const hashData = hashes[j];
          const threatData = hashCheckResults.data.results.find(
            (r: HashCheckResult) => r.hash === hashData.hash
          );

          const result: ScanResult = {
            file,
            hash: hashData.hash,
            isThreat: threatData?.isThreat || false,
            threatName: threatData?.threatName,
            severity: threatData?.severity,
            category: threatData?.category,
          };

          results.push(result);

          if (result.isThreat) {
            threatsFound++;
          }
        }

        if (onProgress) {
          onProgress({
            filesScanned: Math.min(i + this.BATCH_SIZE, totalFiles),
            totalFiles,
            threatsFound,
            currentFile: batch[batch.length - 1]?.name,
          });
        }

        await this.delay(100);
      }

      const endTime = Date.now();

      // Prepare threats payload with sanitized paths
      const threatsPayload = await Promise.all(
        results
          .filter(r => r.isThreat)
          .map(async r => ({
            fileName: r.file.name,
            filePath: await this.sanitizePath(r.file.path, options),
            fileHash: r.hash,
            threatName: r.threatName || 'Unknown',
            severity: r.severity || 'Unknown',
          }))
      );

      // Report scan completion to backend
      await api.post('/scan/report', {
        deviceId: await this.getDeviceId(),
        scanType: type,
        status: 'completed',
        filesScanned: totalFiles,
        threatsFound,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        threats: threatsPayload,
      });

      return results;
    } catch (error) {
      console.error('[SCAN_ERROR]', error);
      
      // Report scan failure to backend
      try {
        await api.post('/scan/report', {
          deviceId: await this.getDeviceId(),
          scanType: type,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
        });
      } catch (reportError) {
        console.error('[SCAN_REPORT_ERROR]', reportError);
      }
      
      throw error;
    } finally {
      this.scanCancelled = false;
    }
  }

  private async getFilesToScan(type: 'quick' | 'full'): Promise<ScanFile[]> {
    const files: ScanFile[] = [];

    if (Platform.OS === 'android') {
      const directories = type === 'quick'
        ? [Paths.document, Paths.cache]
        : await this.getAndroidScanDirectories();

      for (const dir of directories) {
        if (dir) {
          await this.scanDirectory(dir, files, type === 'full');
        }
      }
    } else {
      const directories = [Paths.document, Paths.cache];

      for (const dir of directories) {
        if (dir) {
          await this.scanDirectory(dir, files, type === 'full');
        }
      }
    }

    return files;
  }

  private async getAndroidScanDirectories(): Promise<(string | Directory)[]> {
    // Return basic directories as strings or Directory instances
    return [Paths.document, Paths.cache].filter(Boolean) as (string | Directory)[];
  }

  private async scanDirectory(
    dirPath: string | Directory,
    files: ScanFile[],
    recursive: boolean
  ): Promise<void> {
    try {
      let directory: Directory;
      let dirString: string;

      if (typeof dirPath === 'string') {
        directory = new Directory(dirPath);
        dirString = dirPath;
      } else {
        directory = dirPath;
        dirString = (directory as any).uri || (directory as any).path || '';
      }
      
      // Check if directory exists
      if (!(await (directory as any).exists)) {
        return;
      }

      // List directory contents
      const items = await directory.list();
      
      for (const item of items) {
        if (this.scanCancelled) {
          break;
        }

        const itemPath = this.joinPath(dirString, typeof item === 'string' ? item : (item as any).uri || (item as any).path || '');
        
        try {
          // Try as directory first
          const itemDir = new Directory(itemPath);
          if (await itemDir.exists && recursive) {
            await this.scanDirectory(itemPath, files, recursive);
            continue;
          }
        } catch {
          // Not a directory, continue to check as file
        }

        try {
          // Check as file
          const file = new File(itemPath);
          if (await file.exists) {
            const size = file.size;
            
            // Skip very large files
            if (size && size <= this.MAX_FILE_SIZE) {
              files.push({
                uri: file.uri,
                name: this.getFileName(itemPath),
                size: size,
                path: itemPath,
              });
            }
          }
        } catch (error) {
          console.warn('[SCAN_FILE_ERROR]', itemPath, error);
        }
      }
    } catch (error) {
      console.warn('[SCAN_DIRECTORY_ERROR]', typeof dirPath === 'string' ? dirPath : ((dirPath as any).uri || (dirPath as any).path || ''), error);
    }
  }

  private async hashFile(scanFile: ScanFile): Promise<{ file: ScanFile; hash: string }> {
    try {
      const file = new File(scanFile.path);
      
      // Read file as bytes first, then convert to base64
      const bytes = await file.bytes();
      const base64 = this.bytesToBase64(bytes);

      // Hash using SHA-256
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        base64,
        { encoding: Crypto.CryptoEncoding.HEX }
      );

      return { file: scanFile, hash };
    } catch (error) {
      console.error('[HASH_FILE_ERROR]', scanFile.name, error);
      return { file: scanFile, hash: '' };
    }
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private async getDeviceId(): Promise<string> {
    const { getDeviceId } = await import('../utils/storage');
    return getDeviceId();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async sanitizePath(filePath: string, options?: ScanOptions): Promise<string> {
    if (!filePath) return '';

    let normalized = filePath.replace(/^file:\/\//, '');

    const mode: PathSanitizationMode = options?.pathSanitization ?? 'home';
    const root = options?.root;

    if (mode === 'none') {
      return normalized;
    }

    if (mode === 'relative' && root) {
      const rootNorm = root.replace(/^file:\/\//, '');
      if (normalized.startsWith(rootNorm)) {
        let rel = normalized.slice(rootNorm.length);
        if (rel.startsWith('/') || rel.startsWith('\\')) rel = rel.slice(1);
        return rel || '.';
      }
    }

    if (mode === 'home') {
      normalized = normalized.replace(/(^|[\\/])Users[\\/][^\\/]+/i, '$1~');
      normalized = normalized.replace(/(^|\/)storage\/emulated\/0/i, '$1~');
      normalized = normalized.replace(/(^|\/)data\/user\/\d+/i, '$1~');
      normalized = normalized.replace(/(^|\/)data\/data\/[^\/]+/i, '$1~');
      return normalized;
    }

    if (mode === 'filename') {
      const parts = normalized.split(/[/\\]+/);
      return parts[parts.length - 1] || normalized;
    }

    if (mode === 'hashed') {
      const toHash = (options?.hashSalt ?? '') + normalized;
      try {
        const hash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          toHash,
          { encoding: Crypto.CryptoEncoding.HEX }
        );
        return `hashed:${hash}`;
      } catch (e) {
        const parts = normalized.split(/[/\\]+/);
        return parts[parts.length - 1] || normalized;
      }
    }

    return normalized;
  }

  private joinPath(dirPath: string, item: string): string {
    const sep = dirPath.endsWith('/') || dirPath.endsWith('\\') ? '' : '/';
    return dirPath + sep + item;
  }

  private getFileName(path: string): string {
    const parts = path.split(/[/\\]+/);
    return parts[parts.length - 1] || path;
  }
}

export const scanService = new ScanService();