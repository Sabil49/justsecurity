// services/QuarantineService.ts
import * as FileSystem from 'expo-file-system';
import { api } from './api';
import { storage } from '../utils/storage';

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
  private readonly QUARANTINE_DIR = `${FileSystem.documentDirectory}quarantine/`;

  async initialize() {
    // Create quarantine directory
    const dirInfo = await FileSystem.getInfoAsync(this.QUARANTINE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(this.QUARANTINE_DIR, {
        intermediates: true,
      });
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
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(filePath, { size: true });
      
      if (!fileInfo.exists) {
        throw new Error('File does not exist');
      }

      // Move file to quarantine directory
      const quarantinePath = `${this.QUARANTINE_DIR}${fileHash}`;
      await FileSystem.moveAsync({
        from: filePath,
        to: quarantinePath,
      });

      // Create quarantine record via API
      const deviceId = await storage.getDeviceId();
      const response = await api.post('/scan/report', {
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

      console.log('[FILE_QUARANTINED]', fileName);
      return quarantinePath;
    } catch (error) {
      console.error('[QUARANTINE_ERROR]', error);
      throw error;
    }
  }

  async uploadQuarantinedFile(quarantineId: string, filePath: string): Promise<void> {
    try {
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(filePath, { size: true });
      
      if (!fileInfo.exists || !fileInfo.size) {
        throw new Error('Invalid file');
      }

      // Request signed upload URL
      const response = await api.post('/quarantine/signed-upload', {
        quarantineId,
        fileSize: fileInfo.size,
        contentType: 'application/octet-stream',
      });

      const { uploadUrl, storageKey } = response.data;

      // Upload file to S3
      await FileSystem.uploadAsync(uploadUrl, filePath, {
        httpMethod: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });

      console.log('[FILE_UPLOADED]', storageKey);
    } catch (error) {
      console.error('[UPLOAD_ERROR]', error);
      throw error;
    }
  }

  async deleteQuarantinedFile(quarantineId: string, filePath: string): Promise<void> {
    try {
      // Delete local file
      await FileSystem.deleteAsync(filePath, { idempotent: true });

      // Notify backend
      await api.post('/quarantine/delete', {
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
      // Move file back to original location
      await FileSystem.moveAsync({
        from: filePath,
        to: originalPath,
      });

      console.log('[FILE_RESTORED]', originalPath);
    } catch (error) {
      console.error('[RESTORE_ERROR]', error);
      throw error;
    }
  }

  async listQuarantinedFiles(): Promise<QuarantinedFile[]> {
    try {
      const response = await api.get('/quarantine/list', {
        params: {
          deviceId: await storage.getDeviceId(),
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
      await FileSystem.deleteAsync(this.QUARANTINE_DIR, { idempotent: true });

      // Recreate directory
      await FileSystem.makeDirectoryAsync(this.QUARANTINE_DIR, {
        intermediates: true,
      });

      console.log('[QUARANTINE_CLEARED]');
    } catch (error) {
      console.error('[CLEAR_QUARANTINE_ERROR]', error);
      throw error;
    }
  }
}

export const quarantineService = new QuarantineService();