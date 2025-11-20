// services/QuarantineService.ts
import { getDeviceId } from '@/utils/storage';
import { Directory, File, Paths } from 'expo-file-system/next';

export interface QuarantinedFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileHash: string;
  threatName: string;
  severity: string;
  status: string;
  createdAt: string;
}

// Module-level quarantine directory reference
let quarantineDir: Directory | null = null;

/**
 * Gets or creates the quarantine directory
 */
function getQuarantineDirectory(): Directory {
  if (!quarantineDir) {
    const quarantinePath = `${Paths.document}/quarantine`;
    quarantineDir = new Directory(quarantinePath);
  }
  return quarantineDir;
}

/**
 * Initializes the quarantine service
 */
export async function initialize(): Promise<void> {
  try {
    const dir = getQuarantineDirectory();
    
    // Create quarantine directory if it doesn't exist
    if (!dir.exists) {
      dir.create();
    }
    
    console.log('[QUARANTINE_INITIALIZED]', dir.uri);
  } catch (error) {
    console.error('[QUARANTINE_INIT_ERROR]', error);
    throw error;
  }
}

/**
 * Quarantines a file by moving it to the quarantine directory
 */
export async function quarantineFile(
  filePath: string,
  fileName: string,
  fileHash: string,
  threatName: string,
  severity: string
): Promise<string> {
  try {
    const sourceFile = new File(filePath);

    // Check if source file exists
    if (!sourceFile.exists) {
      throw new Error('File does not exist');
    }

    const fileSize = sourceFile.size || 0;
    const dir = getQuarantineDirectory();

    // Create quarantined file path using hash as filename
    const quarantinePath = `${dir.uri}/${fileHash}`;
    const destinationFile = new File(quarantinePath);

    // Move file to quarantine directory
    await sourceFile.move(destinationFile);

    // Create quarantine record via API
    const deviceId = await getDeviceId();
    await fetch(`${process.env.API_URL}/scan/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        scanType: 'custom',
        status: 'completed',
        filesScanned: 1,
        threatsFound: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        threats: [
          {
            fileName,
            filePath: quarantinePath,
            fileHash,
            threatName,
            severity,
          },
        ],
      }),
    }).then(res => res.json());

    console.log('[FILE_QUARANTINED]', fileName, quarantinePath);
    return quarantinePath;
  } catch (error) {
    console.error('[QUARANTINE_ERROR]', error);
    throw error;
  }
}

/**
 * Uploads a quarantined file to remote storage
 */
export async function uploadQuarantinedFile(
  quarantineId: string,
  filePath: string
): Promise<void> {
  try {
    const file = new File(filePath);

    // Check if file exists and get size
    if (!file.exists) {
      throw new Error('Invalid file');
    }

    const fileSize = file.size;
    if (!fileSize) {
      throw new Error('File has no size');
    }

    // Request signed upload URL
    const response = await fetch(`${process.env.API_URL}/quarantine/signed-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quarantineId,
        fileSize,
        contentType: 'application/octet-stream',
      }),
    }).then(res => res.json());

    const { uploadUrl, storageKey } = response.data;

    // Read file as bytes
    const fileBytes = await file.bytes();

    // Upload to S3 using fetch
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: fileBytes,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status ${uploadResponse.status}`);
    }

    console.log('[FILE_UPLOADED]', storageKey);
  } catch (error) {
    console.error('[UPLOAD_ERROR]', error);
    throw error;
  }
}

/**
 * Deletes a quarantined file from local storage and notifies backend
 */
export async function deleteQuarantinedFile(
  quarantineId: string,
  filePath: string
): Promise<void> {
  try {
    const file = new File(filePath);

    // Delete local file if it exists
    if (file.exists) {
      await file.delete();
    }

    // Notify backend
    await fetch(`${process.env.API_URL}/quarantine/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quarantineId,
      }),
    }).then(res => res.json());

    console.log('[FILE_DELETED]', quarantineId);
  } catch (error) {
    console.error('[DELETE_ERROR]', error);
    throw error;
  }
}

/**
 * Restores a quarantined file back to its original location
 */
export async function restoreQuarantinedFile(
  filePath: string,
  originalPath: string
): Promise<void> {
  try {
    const sourceFile = new File(filePath);
    const destinationFile = new File(originalPath);

    // Check if source exists
    if (!sourceFile.exists) {
      throw new Error('Quarantined file does not exist');
    }

    // Move file back to original location
    await sourceFile.move(destinationFile);

    console.log('[FILE_RESTORED]', originalPath);
  } catch (error) {
    console.error('[RESTORE_ERROR]', error);
    throw error;
  }
}

/**
 * Lists all quarantined files from backend
 */
export async function listQuarantinedFiles(): Promise<QuarantinedFile[]> {
  try {
    const deviceId = await getDeviceId();
    const response = await fetch(`${process.env.API_URL}/quarantine/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
      }),
    }).then(res => res.json());

    return response.data?.quarantines || [];
  } catch (error) {
    console.error('[LIST_QUARANTINE_ERROR]', error);
    return [];
  }
}

/**
 * Clears all quarantined files from local storage
 */
export async function clearAllQuarantine(): Promise<void> {
  try {
    const dir = getQuarantineDirectory();
    
    // Delete quarantine directory
    if (dir.exists) {
      await dir.delete();
    }

    // Recreate directory
    await dir.create();

    console.log('[QUARANTINE_CLEARED]');
  } catch (error) {
    console.error('[CLEAR_QUARANTINE_ERROR]', error);
    throw error;
  }
}

/**
 * Gets statistics about quarantined files
 */
export async function getQuarantineStats(): Promise<{
  totalFiles: number;
  totalSize: number;
}> {
  try {
    const dir = getQuarantineDirectory();
    
    if (!dir.exists) {
      return { totalFiles: 0, totalSize: 0 };
    }

    const files = await dir.list();
    let totalSize = 0;

    for (const fileName of files) {
      try {
        const filePath = `${dir.uri}/${fileName}`;
        const file = new File(filePath);
        if (file.exists && file.size) {
          totalSize += file.size;
        }
      } catch (error) {
        console.warn('[STAT_FILE_ERROR]', fileName, error);
      }
    }

    return {
      totalFiles: files.length,
      totalSize,
    };
  } catch (error) {
    console.error('[GET_STATS_ERROR]', error);
    return { totalFiles: 0, totalSize: 0 };
  }
}

/**
 * Checks if a file exists in quarantine
 */
export async function isFileQuarantined(fileHash: string): Promise<boolean> {
  try {
    const dir = getQuarantineDirectory();
    const filePath = `${dir.uri}/${fileHash}`;
    const file = new File(filePath);
    return file.exists;
  } catch (error) {
    console.error('[CHECK_QUARANTINE_ERROR]', error);
    return false;
  }
}

/**
 * Gets quarantine directory path
 */
export function getQuarantinePath(): string {
  return getQuarantineDirectory().uri;
}