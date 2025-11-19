// services/ScanService.ts
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { api } from './api';

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

class ScanService {
  private readonly BATCH_SIZE = 50;
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private isScanning = false;
  private scanCancelled = false;

  async quickScan(
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult[]> {
    return this.performScan('quick', onProgress);
  }

  async fullScan(
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult[]> {
    return this.performScan('full', onProgress);
  }

  cancelScan() {
    this.scanCancelled = true;
  }

  private async performScan(
    type: 'quick' | 'full',
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult[]> {
    if (this.isScanning) {
      throw new Error('Scan already in progress');
    }

    this.isScanning = true;
    this.scanCancelled = false;

    const startTime = Date.now();
    const results: ScanResult[] = [];
    let threatsFound = 0;

    try {
      // Get files to scan
      const filesToScan = await this.getFilesToScan(type);
      const totalFiles = filesToScan.length;

      // Process files in batches
      for (let i = 0; i < filesToScan.length; i += this.BATCH_SIZE) {
        if (this.scanCancelled) {
          throw new Error('Scan cancelled by user');
        }

        const batch = filesToScan.slice(i, i + this.BATCH_SIZE);
        
        // Hash files in batch
        const hashes = await Promise.all(
          batch.map(file => this.hashFile(file))
        );

        // Check hashes against API
        const hashCheckResults = await api.post('/scan/hash-check', {
          hashes: hashes.map(h => h.hash),
          deviceId: await this.getDeviceId(),
        });

        // Map results
        for (let j = 0; j < batch.length; j++) {
          const file = batch[j];
          const hashData = hashes[j];
          const threatData = hashCheckResults.data.results.find(
            (r: any) => r.hash === hashData.hash
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

        // Update progress
        if (onProgress) {
          onProgress({
            filesScanned: Math.min(i + this.BATCH_SIZE, totalFiles),
            totalFiles,
            threatsFound,
            currentFile: batch[batch.length - 1]?.name,
          });
        }

        // Rate limiting delay
        await this.delay(100);
      }

      // Report scan completion to backend
      const endTime = Date.now();
      await api.post('/scan/report', {
        deviceId: await this.getDeviceId(),
        scanType: type,
        status: 'completed',
        filesScanned: totalFiles,
        threatsFound,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        threats: results
          .filter(r => r.isThreat)
          .map(r => ({
            fileName: r.file.name,
            filePath: r.file.path,
            fileHash: r.hash,
            threatName: r.threatName!,
            severity: r.severity!,
          })),
      });

      return results;
    } catch (error) {
      console.error('[SCAN_ERROR]', error);
      throw error;
    } finally {
      this.isScanning = false;
      this.scanCancelled = false;
    }
  }

  private async getFilesToScan(type: 'quick' | 'full'): Promise<ScanFile[]> {
    const files: ScanFile[] = [];

    // Platform-specific file scanning
    if (Platform.OS === 'android') {
      // Android: Scan downloads, DCIM, and app directories
      const directories = type === 'quick'
        ? [FileSystem.documentDirectory, FileSystem.cacheDirectory]
        : await this.getAndroidScanDirectories();

      for (const dir of directories) {
        if (dir) {
          await this.scanDirectory(dir, files, type === 'full');
        }
      }
    } else {
      // iOS: Limited to app sandbox
      const directories = [
        FileSystem.documentDirectory,
        FileSystem.cacheDirectory,
      ];

      for (const dir of directories) {
        if (dir) {
          await this.scanDirectory(dir, files, type === 'full');
        }
      }
    }

    return files;
  }

  private async getAndroidScanDirectories(): Promise<string[]> {
    // Request storage permissions first
    const { status } = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    
    if (status !== 'granted') {
      return [FileSystem.documentDirectory, FileSystem.cacheDirectory].filter(Boolean) as string[];
    }

    // Return common Android directories
    return [
      FileSystem.documentDirectory,
      FileSystem.cacheDirectory,
      // Note: External storage requires SAF on Android 11+
    ].filter(Boolean) as string[];
  }

  private async scanDirectory(
    dirUri: string,
    files: ScanFile[],
    recursive: boolean
  ): Promise<void> {
    try {
      const items = await FileSystem.readDirectoryAsync(dirUri);

      for (const item of items) {
        const itemUri = `${dirUri}${item}`;
        const info = await FileSystem.getInfoAsync(itemUri, { size: true });

        if (info.exists) {
          if (info.isDirectory && recursive) {
            await this.scanDirectory(`${itemUri}/`, files, recursive);
          } else if (!info.isDirectory) {
            // Skip very large files
            if (info.size && info.size <= this.MAX_FILE_SIZE) {
              files.push({
                uri: itemUri,
                name: item,
                size: info.size,
                path: itemUri,
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn('[SCAN_DIRECTORY_ERROR]', dirUri, error);
      // Continue scanning other directories
    }
  }

  private async hashFile(file: ScanFile): Promise<{ file: ScanFile; hash: string }> {
    try {
      // Read file as base64
      const content = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Hash using SHA-256
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        content,
        { encoding: Crypto.CryptoEncoding.HEX }
      );

      return { file, hash };
    } catch (error) {
      console.error('[HASH_FILE_ERROR]', file.name, error);
      // Return empty hash for failed files
      return { file, hash: '' };
    }
  }

  private async getDeviceId(): Promise<string> {
    // Import from storage utility
    const { getDeviceId } = await import('../utils/storage');
    return getDeviceId();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const scanService = new ScanService();