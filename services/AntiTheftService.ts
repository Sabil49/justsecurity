// services/AntiTheftService.ts
import { clear, getDeviceId, getItem, removeItem, setItem, STORAGE_KEYS } from '@/utils/storage';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import { Directory, Paths } from 'expo-file-system/next';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';

export interface AntiTheftCommand {
  id: string;
  commandType: 'locate' | 'ring' | 'lock' | 'wipe';
  metadata?: any;
}

// Module-level state
let currentSound: Audio.Sound | null = null;
let notificationSubscription: Notifications.EventSubscription | null = null;

/**
 * Initializes the anti-theft service
 */
export async function initialize(): Promise<void> {
  try {
    // Register for push notifications
    await registerPushToken();

    // Set up notification handler
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data;

        if (data?.type === 'anti_theft_command') {
          try {
            await handleCommand({
              id: data.commandId as string,
              commandType: data.commandType as 'locate' | 'ring' | 'lock' | 'wipe',
              metadata: typeof data.metadata === 'string' ? JSON.parse(data.metadata) : (data.metadata || {}),
            });
          } catch (error) {
            console.error('[COMMAND_PARSE_ERROR]', error);
          }

          // Do not present a visible notification for anti-theft commands
          return {
            shouldShowAlert: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: false,
            shouldShowList: false,
          };
        }

        return {
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      },
    });

    // Listen for notification responses (when user taps on a notification)
    notificationSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data;

      if (data?.type === 'anti_theft_command') {
        try {
          await handleCommand({
            id: data.commandId as string,
            commandType: data.commandType as 'locate' | 'ring' | 'lock' | 'wipe',
            metadata: typeof data.metadata === 'string' ? JSON.parse(data.metadata) : (data.metadata || {}),
          });
        } catch (error) {
          console.error('[COMMAND_PARSE_ERROR]', error);
        }
      }
    });

    console.log('[ANTI_THEFT_INITIALIZED]');
  } catch (error) {
    console.error('[ANTI_THEFT_INIT_ERROR]', error);
  }
}

/**
 * Cleans up anti-theft service resources
 */
export function cleanup(): void {
  if (notificationSubscription) {
    notificationSubscription.remove();
    notificationSubscription = null;
  }
  
  if (currentSound) {
    currentSound.unloadAsync().catch(console.error);
    currentSound = null;
  }
}

/**
 * Registers push notification token with backend
 */
async function registerPushToken(): Promise<void> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return;
    }

    const projectId = process.env.EXPO_PROJECT_ID;
    if (!projectId) {
      console.error('EXPO_PROJECT_ID environment variable not set');
      return;
    }

    const token = (await Notifications.getExpoPushTokenAsync({
      projectId,
    })).data;

    // Register token with backend
    const deviceIdValue = await getDeviceId();
    await fetch(`${process.env.API_URL}/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceIdValue,
        deviceName: Device.deviceName || 'Unknown Device',
        platform: Platform.OS,
        osVersion: Platform.Version.toString(),
        appVersion: '1.0.0', // Use from app.json
        pushToken: token,
      }),
    }).then(res => res.json());

    console.log('[PUSH_TOKEN_REGISTERED]', token);

    await setItem(STORAGE_KEYS.PUSH_TOKEN, token);
  } catch (error) {
    console.error('[REGISTER_PUSH_TOKEN_ERROR]', error);
  }
}

/**
 * Handles incoming anti-theft command
 */
export async function handleCommand(command: AntiTheftCommand): Promise<void> {
  console.log('[ANTI_THEFT_COMMAND]', command);

  switch (command.commandType) {
    case 'locate':
      await handleLocate(command);
      break;
    case 'ring':
      await handleRing(command);
      break;
    case 'lock':
      await handleLock(command);
      break;
    case 'wipe':
      await handleWipe(command);
      break;
  }
}

/**
 * Handles locate command - sends device location to backend
 */
async function handleLocate(command: AntiTheftCommand): Promise<void> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    
    if (status !== 'granted') {
      console.error('Location permission not granted');
      return;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const deviceIdValue = await getDeviceId();

    // Send location to backend
    await fetch(`${process.env.API_URL}/device/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceIdValue,
        commandId: command.id,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        timestamp: new Date(location.timestamp).toISOString(),
      }),
    }).then(res => res.json());

    console.log('[LOCATION_SENT]', location.coords);
  } catch (error) {
    console.error('[LOCATE_ERROR]', error);
  }
}

/**
 * Handles ring command - plays loud alarm sound
 */
async function handleRing(command: AntiTheftCommand): Promise<void> {
  try {
    // Play loud alarm sound
    const { sound } = await Audio.Sound.createAsync(
      require('../assets/sounds/alarm.mp3'), // Add alarm sound to assets
      { 
        shouldPlay: true, 
        isLooping: true,
        volume: 1.0,
      }
    );

    currentSound = sound;

    // Show alert to stop ringing
    Alert.alert(
      'Device Ringing',
      'Your device is ringing via anti-theft protection',
      [
        {
          text: 'Stop Ringing',
          onPress: () => stopRinging(),
        },
      ],
      { cancelable: false }
    );

    // Auto-stop after 30 seconds
    setTimeout(() => stopRinging(), 30000);
  } catch (error) {
    console.error('[RING_ERROR]', error);
  }
}

/**
 * Stops the ringing alarm
 */
async function stopRinging(): Promise<void> {
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
      currentSound = null;
    } catch (error) {
      console.error('[STOP_RING_ERROR]', error);
    }
  }
}

/**
 * Handles lock command - locks the device remotely
 */
async function handleLock(command: AntiTheftCommand): Promise<void> {
  try {
    const message = command.metadata?.lockMessage || 'This device has been locked remotely';
    const phoneNumber = command.metadata?.phoneNumber;

    // Set lock state
    await setItem(STORAGE_KEYS.DEVICE_LOCKED, 'true');
    await setItem(STORAGE_KEYS.LOCK_MESSAGE, message);
    
    if (phoneNumber) {
      await setItem(STORAGE_KEYS.LOCK_PHONE_NUMBER, phoneNumber);
    }

    // Show lock screen (navigation handled in app)
    Alert.alert(
      'Device Locked',
      message,
      phoneNumber ? [
        {
          text: 'Call Owner',
          onPress: () => {
            // Implement call functionality
            console.log('Calling:', phoneNumber);
          },
        },
      ] : [],
      { cancelable: false }
    );

    console.log('[DEVICE_LOCKED]');
  } catch (error) {
    console.error('[LOCK_ERROR]', error);
  }
}

/**
 * Handles wipe command - deletes all app data
 */
async function handleWipe(command: AntiTheftCommand): Promise<void> {
  // CRITICAL: Implement with extreme caution
  // This is a destructive operation
  
  Alert.alert(
    'Device Wipe Requested',
    'This will delete all app data. This action cannot be undone.',
    [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Wipe Data',
        style: 'destructive',
        onPress: async () => {
          try {
            // Clear all app data
            await clear();
            
            // Clear quarantine files
            if (Paths.document) {
              const quarantinePath = `${Paths.document}/quarantine`;
              const quarantineDir = new Directory(quarantinePath);
              
              if (quarantineDir.exists) {
                await quarantineDir.delete();
              }
            }

            console.log('[DEVICE_WIPED]');
            
            // Show completion message
            Alert.alert(
              'Data Wiped',
              'All app data has been removed.',
              [{ text: 'OK' }]
            );
          } catch (error) {
            console.error('[WIPE_ERROR]', error);
          }
        },
      },
    ]
  );
}

/**
 * Checks if device is currently locked
 */
export async function isDeviceLocked(): Promise<boolean> {
  const locked = await getItem(STORAGE_KEYS.DEVICE_LOCKED);
  return locked === 'true';
}

/**
 * Gets the current lock message
 */
export async function getLockMessage(): Promise<string> {
  return await getItem(STORAGE_KEYS.LOCK_MESSAGE) || 'Device is locked';
}

/**
 * Gets the lock screen phone number if set
 */
export async function getLockPhoneNumber(): Promise<string | null> {
  return await getItem(STORAGE_KEYS.LOCK_PHONE_NUMBER);
}

/**
 * Unlocks the device
 */
export async function unlockDevice(): Promise<void> {
  await removeItem(STORAGE_KEYS.DEVICE_LOCKED);
  await removeItem(STORAGE_KEYS.LOCK_MESSAGE);
  await removeItem(STORAGE_KEYS.LOCK_PHONE_NUMBER);
  console.log('[DEVICE_UNLOCKED]');
}

/**
 * Manually triggers a location report
 */
export async function reportLocation(): Promise<void> {
  await handleLocate({
    id: `manual-${Date.now()}`,
    commandType: 'locate',
  });
}