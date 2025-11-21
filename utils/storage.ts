// utils/storage.ts
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';

interface StorageOptions {
  secure?: boolean;
  ttl?: number; // Time to live in seconds
}

class StorageManager {
  private readonly SECURE_KEYS = ['authToken', 'refreshToken', 'apiKey'];

  async getItem(key: string): Promise<string | null> {
    try {
      if (this.SECURE_KEYS.includes(key)) {
        return await SecureStore.getItemAsync(key);
      }
      
      const value = await AsyncStorage.getItem(key);
      if (!value) return null;

      // Check TTL
      const data = JSON.parse(value);
      if (data._ttl && data._ttl < Date.now()) {
        await this.removeItem(key);
        return null;
      }

      return data.value;
    } catch (error) {
      console.error('[STORAGE_GET_ERROR]', key, error);
      return null;
    }
  }

  async setItem(
    key: string,
    value: string,
    options?: StorageOptions
  ): Promise<void> {
    try {
      if (this.SECURE_KEYS.includes(key) || options?.secure) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      const data: any = { value };
      
      if (options?.ttl) {
        data._ttl = Date.now() + options.ttl * 1000;
      }

      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.error('[STORAGE_SET_ERROR]', key, error);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      if (this.SECURE_KEYS.includes(key)) {
        await SecureStore.deleteItemAsync(key);
        return;
      }

      await AsyncStorage.removeItem(key);
    } catch (error) {
      console.error('[STORAGE_REMOVE_ERROR]', key, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await AsyncStorage.clear();
      
      // Clear secure store items
      for (const key of this.SECURE_KEYS) {
        await SecureStore.deleteItemAsync(key);
      }
    } catch (error) {
      console.error('[STORAGE_CLEAR_ERROR]', error);
    }
  }

  async getDeviceId(): Promise<string> {
    let deviceId = await this.getItem('deviceId');
    
    if (!deviceId) {
      deviceId = uuidv4();
      await this.setItem('deviceId', deviceId);
    }

    return deviceId;
  }

  async getAuthToken(): Promise<string | null> {
    return await this.getItem('authToken');
  }

  async setAuthToken(token: string): Promise<void> {
    await this.setItem('authToken', token, { secure: true });
  }

  async clearAuthToken(): Promise<void> {
    await this.removeItem('authToken');
  }

  async getAllKeys(): Promise<string[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return Array.from(keys);
    } catch (error) {
      console.error('[STORAGE_GET_ALL_KEYS_ERROR]', error);
      return [];
    }
  }
}

export const storage = new StorageManager();