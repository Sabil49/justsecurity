// utils/storage.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Storage keys - centralized for consistency
 */
export const STORAGE_KEYS = {
  // Authentication
  FIREBASE_ID_TOKEN: 'firebase_id_token',
  FIREBASE_REFRESH_TOKEN: 'firebase_refresh_token',
  USER_ID: 'user_id',
  DEVICE_ID: 'device_id',
  PUSH_TOKEN: 'push_token',

  // Device state
  DEVICE_LOCKED: 'device_locked',
  LOCK_MESSAGE: 'lock_message',
  LOCK_PHONE_NUMBER: 'lock_phone_number',

  // Subscription
  SUBSCRIPTION_TIER: 'subscription_tier',
  SUBSCRIPTION_EXPIRY: 'subscription_expiry',

  // Security settings
  BIOMETRIC_ENABLED: 'biometric_enabled',
  PIN_CODE: 'pin_code',

  // App preferences
  LAST_SCAN_TIME: 'last_scan_time',
  APP_LOCK_ENABLED: 'app_lock_enabled',

  // Analytics
  TELEMETRY_SESSION_ID: 'telemetry_session_id',
} as const;

/**
 * Sensitive keys that should use secure storage
 */
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

const SENSITIVE_KEYS: ReadonlySet<StorageKey> = new Set([
  STORAGE_KEYS.FIREBASE_ID_TOKEN,
  STORAGE_KEYS.FIREBASE_REFRESH_TOKEN,
  STORAGE_KEYS.PIN_CODE,
  STORAGE_KEYS.DEVICE_ID, // Device ID is sensitive
]);

/**
 * Get item from storage (automatically uses secure storage for sensitive data)
 * @param key - Storage key
 * @returns Value or null if not found
 */
export async function getItem(key: StorageKey): Promise<string | null> {
  try {
    // Use secure storage for sensitive data
    if (SENSITIVE_KEYS.has(key)) {
      return await SecureStore.getItemAsync(key);
    }

    // Use AsyncStorage for non-sensitive data
    return await AsyncStorage.getItem(key);
  } catch (error) {
    console.error(`[STORAGE_GET_ERROR] ${key}:`, error);
    return null;
  }
}
/**
 * Set item in storage (automatically uses secure storage for sensitive data)
 * @param key - Storage key
 * @param value - Value to store
 */
export async function setItem(key: StorageKey, value: string): Promise<void> {
  try {
    // Validate input
    if (!key || typeof value !== 'string') {
      throw new Error('Invalid key or value');
    }

    // Use secure storage for sensitive data
    if (SENSITIVE_KEYS.has(key)) {
      await SecureStore.setItemAsync(key, value);
    } else {
      // Use AsyncStorage for non-sensitive data
      await AsyncStorage.setItem(key, value);
    }
  } catch (error) {
    console.error(`[STORAGE_SET_ERROR] ${key}:`, error);
    throw new Error(`Failed to store ${key}`);
  }
}
/**
 * Remove item from storage
 * @param key - Storage key
 */
export async function removeItem(key: StorageKey): Promise<void> {
  try {
    if (SENSITIVE_KEYS.has(key)) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch (error) {
    console.error(`[STORAGE_REMOVE_ERROR] ${key}:`, error);
  }
}

/**
 * Clear all stored data (both secure and regular storage)
 * WARNING: This is destructive and typically used for wipe command
 */
export async function clear(): Promise<void> {
  try {
    // Clear AsyncStorage
    await AsyncStorage.clear();

    // Clear SecureStore
    // Note: Expo SecureStore doesn't have a clear-all method,
    // so we must remove keys individually
    for (const key of SENSITIVE_KEYS.values()) {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch (error) {
        // Continue even if a key doesn't exist
        console.warn(`[STORAGE_CLEAR_KEY_WARN] ${key}:`, error);
      }
    }

    console.log('[STORAGE_CLEARED]');
  } catch (error) {
    console.error('[STORAGE_CLEAR_ERROR]', error);
    throw new Error('Failed to clear storage');
  }
}

/**
 * Get or generate a unique device ID
 * Device ID is generated once and stored securely
 */
export async function getDeviceId(): Promise<string> {
  try {
    // Check if device ID already exists
    let deviceId = await getItem(STORAGE_KEYS.DEVICE_ID);

    if (!deviceId) {
      // Generate new device ID
      const randomBytes = await Crypto.getRandomBytesAsync(16);
      deviceId = Array.from(randomBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');

      // Store device ID securely
      await setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
      console.log('[DEVICE_ID_GENERATED]', deviceId);
    }

    return deviceId;
  } catch (error) {
    console.error('[GET_DEVICE_ID_ERROR]', error);
    throw new Error('Failed to get device ID');
  }
}

/**
 * Store Firebase authentication tokens securely
 */
export async function setAuthTokens(
  idToken: string,
  refreshToken?: string
): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.FIREBASE_ID_TOKEN, idToken);

    if (refreshToken) {
      await setItem(STORAGE_KEYS.FIREBASE_REFRESH_TOKEN, refreshToken);
    }

    console.log('[AUTH_TOKENS_STORED]');
  } catch (error) {
    console.error('[SET_AUTH_TOKENS_ERROR]', error);
    throw new Error('Failed to store authentication tokens');
  }
}

/**
 * Get Firebase ID token
 */
export async function getIdToken(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.FIREBASE_ID_TOKEN);
}

/**
 * Get Firebase refresh token
 */
export async function getRefreshToken(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.FIREBASE_REFRESH_TOKEN);
}

/**
 * Clear authentication tokens (logout)
 */
export async function clearAuthTokens(): Promise<void> {
  try {
    await removeItem(STORAGE_KEYS.FIREBASE_ID_TOKEN);
    await removeItem(STORAGE_KEYS.FIREBASE_REFRESH_TOKEN);
    console.log('[AUTH_TOKENS_CLEARED]');
  } catch (error) {
    console.error('[CLEAR_AUTH_TOKENS_ERROR]', error);
    throw new Error('Failed to clear authentication tokens');
  }
}

/**
 * Store user information (non-sensitive)
 */
export async function setUser(userId: string): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.USER_ID, userId);
  } catch (error) {
    console.error('[SET_USER_ERROR]', error);
    throw new Error('Failed to store user information');
  }
}

/**
 * Get stored user ID
 */
export async function getUser(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.USER_ID);
}

/**
 * Store push notification token
 */
export async function setPushToken(token: string): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.PUSH_TOKEN, token);
  } catch (error) {
    console.error('[SET_PUSH_TOKEN_ERROR]', error);
    throw new Error('Failed to store push token');
  }
}

/**
 * Get push notification token
 */
export async function getPushToken(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.PUSH_TOKEN);
}

/**
 * Store subscription information
 */
export async function setSubscription(
  tier: 'FREE' | 'PREMIUM',
  expiryDate?: string
): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.SUBSCRIPTION_TIER, tier);

    if (expiryDate) {
      await setItem(STORAGE_KEYS.SUBSCRIPTION_EXPIRY, expiryDate);
    }

    console.log('[SUBSCRIPTION_STORED]', tier);
  } catch (error) {
    console.error('[SET_SUBSCRIPTION_ERROR]', error);
    throw new Error('Failed to store subscription');
  }
}

/**
 * Get subscription tier
 */
export async function getSubscriptionTier(): Promise<'FREE' | 'PREMIUM'> {
  try {
    const tier = await getItem(STORAGE_KEYS.SUBSCRIPTION_TIER);
    if (tier === 'PREMIUM') {
      return 'PREMIUM';
    }
    return 'FREE';
  } catch (error) {
    console.error('[GET_SUBSCRIPTION_ERROR]', error);
    return 'FREE';
  }
}

/**
 * Get subscription expiry date
 */
export async function getSubscriptionExpiry(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.SUBSCRIPTION_EXPIRY);
}

/**
 * Check if subscription is expired
 */
export async function isSubscriptionExpired(): Promise<boolean> {
  try {
        const tier = await getSubscriptionTier();
    if (tier === 'FREE') {
      return false; // FREE tier never expires
    }
    const expiryDate = await getSubscriptionExpiry();

    if (!expiryDate) {
      return true; // PREMIUM without expiry = expired
    }

    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      return true; // Invalid date = expired
    }
    return new Date() > expiry;
  } catch (error) {
    console.error('[CHECK_EXPIRY_ERROR]', error);
    return true;
  }
}

/**
 * Store device lock state
 */
export async function setDeviceLocked(locked: boolean): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.DEVICE_LOCKED, locked ? 'true' : 'false');
  } catch (error) {
    console.error('[SET_DEVICE_LOCKED_ERROR]', error);
  }
}

/**
 * Get device lock state
 */
export async function isDeviceLocked(): Promise<boolean> {
  const locked = await getItem(STORAGE_KEYS.DEVICE_LOCKED);
  return locked === 'true';
}

/**
 * Store lock message
 */
export async function setLockMessage(message: string): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.LOCK_MESSAGE, message);
  } catch (error) {
    console.error('[SET_LOCK_MESSAGE_ERROR]', error);
  }
}

/**
 * Get lock message
 */
export async function getLockMessage(): Promise<string> {
  const message = await getItem(STORAGE_KEYS.LOCK_MESSAGE);
  return message || 'Device is locked';
}

/**
 * Store lock phone number
 */
export async function setLockPhoneNumber(phone: string): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.LOCK_PHONE_NUMBER, phone);
  } catch (error) {
    console.error('[SET_LOCK_PHONE_ERROR]', error);
  }
}

/**
 * Get lock phone number
 */
export async function getLockPhoneNumber(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.LOCK_PHONE_NUMBER);
}

/**
 * Store biometric setting
 */
export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('[SET_BIOMETRIC_ERROR]', error);
  }
}

/**
 * Check if biometric is enabled
 */
export async function isBiometricEnabled(): Promise<boolean> {
  const enabled = await getItem(STORAGE_KEYS.BIOMETRIC_ENABLED);
  return enabled === 'true';
}

/**
 * Store PIN code (encrypted)
 * In production, consider using a specialized encryption library
 */
export async function setPinCode(pin: string): Promise<void> {
  try {
    if (pin.length < 4 || pin.length > 6) {
      throw new Error('PIN must be between 4 and 6 digits');
    }

    // Hash PIN before storing (simple approach - use bcrypt in production)
    const hashedPin = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      pin
    );

    await setItem(STORAGE_KEYS.PIN_CODE, hashedPin);
    console.log('[PIN_CODE_STORED]');
  } catch (error) {
    console.error('[SET_PIN_CODE_ERROR]', error);
    throw new Error('Failed to store PIN code');
  }
}

/**
 * Verify PIN code
 */
export async function verifyPinCode(pin: string): Promise<boolean> {
  try {
    const storedHash = await getItem(STORAGE_KEYS.PIN_CODE);

    if (!storedHash) {
      return false;
    }

    // Hash input PIN and compare
    const inputHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      pin
    );

    return inputHash === storedHash;
  } catch (error) {
    console.error('[VERIFY_PIN_CODE_ERROR]', error);
    return false;
  }
}

/**
 * Clear PIN code
 */
export async function clearPinCode(): Promise<void> {
  try {
    await removeItem(STORAGE_KEYS.PIN_CODE);
  } catch (error) {
    console.error('[CLEAR_PIN_CODE_ERROR]', error);
  }
}

/**
 * Store last scan time
 */
export async function setLastScanTime(timestamp: number): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.LAST_SCAN_TIME, timestamp.toString());
  } catch (error) {
    console.error('[SET_LAST_SCAN_TIME_ERROR]', error);
  }
}

/**
 * Get last scan time
 */
export async function getLastScanTime(): Promise<number | null> {
  try {
    const time = await getItem(STORAGE_KEYS.LAST_SCAN_TIME);
    return time ? parseInt(time, 10) : null;
  } catch (error) {
    console.error('[GET_LAST_SCAN_TIME_ERROR]', error);
    return null;
  }
}

/**
 * Get time since last scan (in milliseconds)
 */
export async function getTimeSinceLastScan(): Promise<number | null> {
  try {
    const lastScan = await getLastScanTime();
    return lastScan ? Date.now() - lastScan : null;
  } catch (error) {
    console.error('[GET_TIME_SINCE_SCAN_ERROR]', error);
    return null;
  }
}

/**
 * Store app lock setting
 */
export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  try {
    await setItem(STORAGE_KEYS.APP_LOCK_ENABLED, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('[SET_APP_LOCK_ERROR]', error);
  }
}

/**
 * Check if app lock is enabled
 */
export async function isAppLockEnabled(): Promise<boolean> {
  const enabled = await getItem(STORAGE_KEYS.APP_LOCK_ENABLED);
  return enabled === 'true';
}

/**
 * Generate and store telemetry installation ID
 */
export async function getTelemetryInstallationId(): Promise<string> {
  try {
    let sessionId = await getItem(STORAGE_KEYS.TELEMETRY_SESSION_ID);

    if (!sessionId) {
      // Generate new session ID
      const randomBytes = await Crypto.getRandomBytesAsync(8);
      sessionId = Array.from(randomBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');

      await setItem(STORAGE_KEYS.TELEMETRY_SESSION_ID, sessionId);
    }

    return sessionId;
  } catch (error) {
    console.error('[GET_TELEMETRY_SESSION_ID_ERROR]', error);
    return `session-${Date.now()}`;
  }
}

/**
 * Check storage health and availability
 */
export async function checkStorageHealth(): Promise<{
  asyncStorageAvailable: boolean;
  secureStoreAvailable: boolean;
  canWrite: boolean;
}> {
  const health = {
    asyncStorageAvailable: false,
    secureStoreAvailable: false,
    canWrite: false,
  };

  try {
    // Test AsyncStorage
    const testKey = `health_check_${Date.now()}`;
    const testValue = 'test';

    try {
      await AsyncStorage.setItem(testKey, testValue);
      const retrieved = await AsyncStorage.getItem(testKey);
      health.asyncStorageAvailable = retrieved === testValue;
      await AsyncStorage.removeItem(testKey);
    } catch (error) {
      console.warn('[ASYNC_STORAGE_HEALTH_CHECK]', error);
    }

    // Test SecureStore
    try {
      await SecureStore.setItemAsync(testKey, testValue);
      const retrieved = await SecureStore.getItemAsync(testKey);
      health.secureStoreAvailable = retrieved === testValue;
      await SecureStore.deleteItemAsync(testKey);
    } catch (error) {
      console.warn('[SECURE_STORE_HEALTH_CHECK]', error);
    }

    health.canWrite = health.asyncStorageAvailable && health.secureStoreAvailable;
  } catch (error) {
    console.error('[STORAGE_HEALTH_CHECK_ERROR]', error);
  }

  return health;
}
/**
 * Export all storage data for debugging (excludes sensitive data)
 */
export async function exportStorageData(): Promise<Record<string, string | null>> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    
    // Filter out sensitive keys to truly exclude sensitive data
    const nonSensitiveKeys = allKeys.filter(key => 
      !SENSITIVE_KEYS.has(key as StorageKey)
    );
    
    const allData = await Promise.all(
      nonSensitiveKeys.map(async (key) => {
        const value = await AsyncStorage.getItem(key);
        return [key, value] as [string, string | null];
      })
    );

    return Object.fromEntries(allData);
  } catch (error) {
    console.error('[EXPORT_STORAGE_ERROR]', error);
    return {};
  }
}   