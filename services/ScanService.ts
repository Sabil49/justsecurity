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

// Constants
const BATCH_SIZE = 50;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// Scan state management
let scanPromise: Promise<ScanResult[]> | null = null;
let currentScanKey: string | null = null;
let scanCancelled = false;

/**
 * Performs a quick scan of essential directories
 */
export async function quickScan(
  onProgress?: (progress: ScanProgress) => void,
  options?: ScanOptions
): Promise<ScanResult[]> {
  return performScan('quick', onProgress, options);
}

/**
 * Performs a full scan of all accessible directories
 */
export async function fullScan(
  onProgress?: (progress: ScanProgress) => void,
  options?: ScanOptions
): Promise<ScanResult[]> {
  return performScan('full', onProgress, options);
}

/**
 * Cancels the current scan operation
 */
export function cancelScan(): void {
  scanCancelled = true;
}

/**
 * Main scan orchestration function
 */
async function performScan(
  type: 'quick' | 'full',
  onProgress?: (progress: ScanProgress) => void,
  options?: ScanOptions
): Promise<ScanResult[]> {
  const scanKey = `${type}-${JSON.stringify(options || {})}`;
  
  if (scanPromise && currentScanKey === scanKey) {
    return scanPromise;
  }

  // Cancel any existing scan with different parameters
  if (scanPromise) {
    cancelScan();
    await scanPromise.catch(() => {});
  }

  scanCancelled = false;
  currentScanKey = scanKey;
  scanPromise = executeScan(type, onProgress, options);

  try {
    return await scanPromise;
  } finally {
    scanPromise = null;
    currentScanKey = null;
  }
}

/**
 * Executes the actual scan process
 */
async function executeScan(
  type: 'quick' | 'full',
  onProgress?: (progress: ScanProgress) => void,
  options?: ScanOptions
): Promise<ScanResult[]> {
  const startTime = Date.now();
  const results: ScanResult[] = [];
  let threatsFound = 0;

  try {
    const filesToScan = await getFilesToScan(type);
    const totalFiles = filesToScan.length;

    for (let i = 0; i < filesToScan.length; i += BATCH_SIZE) {
      if (scanCancelled) {
        throw new Error('Scan cancelled by user');
      }

      const batch = filesToScan.slice(i, i + BATCH_SIZE);
      
      const hashes = await Promise.all(
        batch.map(file => hashFile(file))
      );

      const hashCheckResults = await fetch(`${process.env.API_URL}/scan/hash-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hashes: hashes.map(h => h.hash),
          deviceId: await getDeviceId(),
        }),
      }).then(res => res.json() as Promise<{ data: HashCheckResponse }>);

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
          filesScanned: Math.min(i + BATCH_SIZE, totalFiles),
          totalFiles,
          threatsFound,
          currentFile: batch[batch.length - 1]?.name,
        });
      }

      await delay(100);
    }

    const endTime = Date.now();

    // Prepare threats payload with sanitized paths
    const threatsPayload = await Promise.all(
      results
        .filter(r => r.isThreat)
        .map(async r => ({
          fileName: r.file.name,
          filePath: await sanitizePath(r.file.path, options),
          fileHash: r.hash,
          threatName: r.threatName || 'Unknown',
          severity: r.severity || 'Unknown',
        }))
    );

    // Report scan completion to backend
    await fetch(`${process.env.API_URL}/scan/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: await getDeviceId(),
        scanType: type,
        status: 'completed',
        filesScanned: totalFiles,
        threatsFound,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        threats: threatsPayload,
      }),
    }).then(res => res.json());

    return results;
  } catch (error) {
    console.error('[SCAN_ERROR]', error);
    
    // Report scan failure to backend
    try {
      await fetch(`${process.env.API_URL}/scan/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: await getDeviceId(),
          scanType: type,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
        }),
      }).then(res => res.json());
    } catch (reportError) {
      console.error('[SCAN_REPORT_ERROR]', reportError);
    }
    
    throw error;
  } finally {
    scanCancelled = false;
  }
}

/**
 * Gets the list of files to scan based on scan type
 */
async function getFilesToScan(type: 'quick' | 'full'): Promise<ScanFile[]> {
  const files: ScanFile[] = [];

  if (Platform.OS === 'android') {
    const directories = type === 'quick'
      ? [Paths.document, Paths.cache]
      : await getAndroidScanDirectories();

    for (const dir of directories) {
      if (dir) {
        await scanDirectory(dir, files, type === 'full');
      }
    }
  } else {
    const directories = [Paths.document, Paths.cache];

    for (const dir of directories) {
      if (dir) {
        await scanDirectory(dir, files, type === 'full');
      }
    }
  }

  return files;
}

/**
 * Gets Android-specific directories for full scan
 */
async function getAndroidScanDirectories(): Promise<string[]> {
    return [
    Paths.document,
    Paths.cache,
    Paths.download
  ].filter(Boolean) as string[];
}

/**
 * Recursively scans a directory for files
 */
async function scanDirectory(
  dirPath: string | Directory,
  files: ScanFile[],
  recursive: boolean
): Promise<void> {
  try {
    // Normalize to Directory instance and base path string
    const directory: Directory = typeof dirPath === 'string' ? new Directory(dirPath) : dirPath;
    const basePath: string = typeof dirPath === 'string'
      ? dirPath
      : (('uri' in dirPath && typeof (dirPath as any).uri === 'string') ? (dirPath as any).uri : (dirPath as any).path ?? '');

    // Check if directory exists
    if (!directory.exists) {
      return;
    }

    // List directory contents
    const items = await directory.list();
    
    for (const item of items) {
      if (scanCancelled) {
        break;
      }

      // Ensure we pass a string name/path to joinPath — items can be strings or Directory/File objects
      const itemName: string = typeof item === 'string'
        ? item
        : (('name' in item && typeof (item as any).name === 'string')
            ? (item as any).name
            : (('uri' in item && typeof (item as any).uri === 'string')
                ? (item as any).uri
                : (('path' in item && typeof (item as any).path === 'string')
                    ? (item as any).path
                    : String(item))));

      const itemPath = joinPath(basePath, itemName);
      
      try {
        // Try as directory first
        const itemDir = new Directory(itemPath);
        if (itemDir.exists && recursive) {
          await scanDirectory(itemPath, files, recursive);
          continue;
        }
      } catch {
        // Not a directory, continue to check as file
      }

      try {
        // Check as file
        const file = new File(itemPath);
        if (file.exists) {
          const size = file.size;
          
          // Skip very large files
          if (size && size <= MAX_FILE_SIZE) {
            files.push({
              uri: file.uri,
              name: getFileName(itemPath),
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
    const pathForLog = typeof dirPath === 'string' ? dirPath : (('uri' in dirPath && typeof (dirPath as any).uri === 'string') ? (dirPath as any).uri : (dirPath as any).path ?? '');
    console.warn('[SCAN_DIRECTORY_ERROR]', pathForLog, error);
  }
}

/**
 * Computes SHA-256 hash of a file
 */
async function hashFile(scanFile: ScanFile): Promise<{ file: ScanFile; hash: string }> {
  try {
    const file = new File(scanFile.path);
    
    // Read file as bytes first, then convert to base64
    const bytes = await file.bytes();
    const base64 = bytesToBase64(bytes);

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

/**
 * Converts byte array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Gets the unique device identifier
 */
async function getDeviceId(): Promise<string> {
  const { getDeviceId: getDeviceIdImpl } = await import('@/utils/storage');
  return getDeviceIdImpl();
}

/**
 * Delays execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitizes file paths based on configured mode
 */
async function sanitizePath(filePath: string, options?: ScanOptions): Promise<string> {
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

/**
 * Joins directory path with item name
 */
function joinPath(dirPath: string, item: string): string {
  const sep = dirPath.endsWith('/') || dirPath.endsWith('\\') ? '' : '/';
  return dirPath + sep + item;
}

/**
 * Extracts filename from full path
 */
function getFileName(path: string): string {
  const parts = path.split(/[/\\]+/);
  return parts[parts.length - 1] || path;
}