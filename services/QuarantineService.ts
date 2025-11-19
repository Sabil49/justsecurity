// services/QuarantineService.ts
import { Directory, File, Paths } from 'expo-file-system/next';
import { getDeviceId } from '../utils/storage';

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

class QuarantineService {
  private quarantineDir: Directory;

  constructor() {
    // Initialize quarantine directory in documents
    const quarantinePath = `${Paths.document}/quarantine`;
    this.quarantineDir = new Directory(quarantinePath);
  }

  async initialize(): Promise<void> {
    try {
      // Create quarantine directory if it doesn't exist
      if (!this.quarantineDir.exists) {
        await this.quarantineDir.create();
      }
      console.log('[QUARANTINE_INITIALIZED]', this.quarantineDir.uri);
    } catch (error) {
      console.error('[QUARANTINE_INIT_ERROR]', error);
      throw error;
    }
  }

  async quarantineFile(
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

      // Create quarantined file path using hash as filename
      const quarantinePath = `${this.quarantineDir.uri}/${fileHash}`;
      const destinationFile = new File(quarantinePath);

      // Move file to quarantine directory
      await sourceFile.move(destinationFile);

      // Create quarantine record via API
      const deviceId = await getDeviceId();
      await process.env.API_URL.post('/scan/report', {
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
      });

      console.log('[FILE_QUARANTINED]', fileName, quarantinePath);
      return quarantinePath;
    } catch (error) {
      console.error('[QUARANTINE_ERROR]', error);
      throw error;
    }
  }

  async uploadQuarantinedFile(quarantineId: string, filePath: string): Promise<void> {
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
      const response = await process.env.API_URL.post('/quarantine/signed-upload', {
        quarantineId,
        fileSize,
        contentType: 'application/octet-stream',
      });

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

  async deleteQuarantinedFile(quarantineId: string, filePath: string): Promise<void> {
    try {
      const file = new File(filePath);

      // Delete local file if it exists
      if (file.exists) {
        await file.delete();
      }

      // Notify backend
      await process.env.API_URL.post('/quarantine/delete', {
        quarantineId,
      });

      console.log('[FILE_DELETED]', quarantineId);
    } catch (error) {
      console.error('[DELETE_ERROR]', error);
      throw error;
    }
  }

  async restoreQuarantinedFile(filePath: string, originalPath: string): Promise<void> {
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

  async listQuarantinedFiles(): Promise<QuarantinedFile[]> {
    try {
      const deviceId = await getDeviceId();
      const response = await process.env.API_URL.get('/quarantine/list', {
        params: {
          deviceId,
        },
      });

      return response.data.quarantines || [];
    } catch (error) {
      console.error('[LIST_QUARANTINE_ERROR]', error);
      return [];
    }
  }

  async clearAllQuarantine(): Promise<void> {
    try {
      // Delete quarantine directory
      if (this.quarantineDir.exists) {
        await this.quarantineDir.delete();
      }

      // Recreate directory
      await this.quarantineDir.create();

      console.log('[QUARANTINE_CLEARED]');
    } catch (error) {
      console.error('[CLEAR_QUARANTINE_ERROR]', error);
      throw error;
    }
  }

  async getQuarantineStats(): Promise<{
    totalFiles: number;
    totalSize: number;
  }> {
    try {
      if (!this.quarantineDir.exists) {
        return { totalFiles: 0, totalSize: 0 };
      }

      const files = await this.quarantineDir.list();
      let totalSize = 0;

      for (const fileName of files) {
        try {
          const filePath = `${this.quarantineDir.uri}/${fileName}`;
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
}

export const quarantineService = new QuarantineService();