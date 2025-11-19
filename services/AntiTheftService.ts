// services/AntiTheftService.ts
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { storage } from '../utils/storage';

export interface AntiTheftCommand {
  id: string;
  commandType: 'locate' | 'ring' | 'lock' | 'wipe';
  metadata?: any;
}

class AntiTheftService {
  private sound: Audio.Sound | null = null;
  private isLocked: boolean | null = null;
  private notificationSubscription: any = null;
  async initialize() {
       // Initialize lock state from storage
    this.isLocked = await this.isDeviceLocked();

    // Register for push notifications
    await this.registerPushToken();
    // Set up notification handler
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data;

        if (data?.type === 'anti_theft_command') {
          try {
            await this.handleCommand({
              id: data.commandId as string,
              commandType: data.commandType as 'locate' | 'ring' | 'lock' | 'wipe',
              metadata: JSON.parse(data.metadata as string || '{}'),
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
    this.notificationSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data;

      if (data?.type === 'anti_theft_command') {
        try {
          await this.handleCommand({
            id: data.commandId as string,
            commandType: data.commandType as 'locate' | 'ring' | 'lock' | 'wipe',
            metadata: JSON.parse(data.metadata as string || '{}'),
          });
        } catch (error) {
          console.error('[COMMAND_PARSE_ERROR]', error);
        }
      }
    });

  }

  private async registerPushToken() {
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
      const deviceId = await storage.getDeviceId();
      await process.env.API_URL.post('/device/register', {
        deviceId,
        deviceName: Device.deviceName || 'Unknown Device',
        platform: Platform.OS,
        osVersion: Platform.Version.toString(),
        appVersion: '1.0.0', // Use from app.json
        pushToken: token,
      });

      await storage.setItem('pushToken', token);
    } catch (error) {
      console.error('[REGISTER_PUSH_TOKEN_ERROR]', error);
    }
  }

  async handleCommand(command: AntiTheftCommand) {
    console.log('[ANTI_THEFT_COMMAND]', command);

    switch (command.commandType) {
      case 'locate':
        await this.handleLocate(command);
        break;
      case 'ring':
        await this.handleRing(command);
        break;
      case 'lock':
        await this.handleLock(command);
        break;
      case 'wipe':
        await this.handleWipe(command);
        break;
    }
  }

  private async handleLocate(command: AntiTheftCommand) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        console.error('Location permission not granted');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const deviceId = await storage.getDeviceId();

      // Send location to backend
      await process.env.API_URL.post('/device/location', {
        deviceId,
        commandId: command.id,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        timestamp: new Date(location.timestamp).toISOString(),
      });

      console.log('[LOCATION_SENT]', location.coords);
    } catch (error) {
      console.error('[LOCATE_ERROR]', error);
    }
  }

  private async handleRing(command: AntiTheftCommand) {
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

      this.sound = sound;

      // Show alert to stop ringing
      Alert.alert(
        'Device Ringing',
        'Your device is ringing via anti-theft protection',
        [
          {
            text: 'Stop Ringing',
            onPress: () => this.stopRinging(),
          },
        ],
        { cancelable: false }
      );

      // Auto-stop after 30 seconds
      setTimeout(() => this.stopRinging(), 30000);
    } catch (error) {
      console.error('[RING_ERROR]', error);
    }
  }

  private async stopRinging() {
    if (this.sound) {
      await this.sound.stopAsync();
      await this.sound.unloadAsync();
      this.sound = null;
    }
  }

  private async handleLock(command: AntiTheftCommand) {
    try {
      const message = command.metadata?.lockMessage || 'This device has been locked remotely';
      const phoneNumber = command.metadata?.phoneNumber;

      // Set lock state
      this.isLocked = true;
      await storage.setItem('deviceLocked', 'true');
      await storage.setItem('lockMessage', message);
      
      if (phoneNumber) {
        await storage.setItem('lockPhoneNumber', phoneNumber);
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

  private async handleWipe(command: AntiTheftCommand) {
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
              await storage.clear();
              
              // Clear quarantine files
              if (FileSystem.documentDirectory) {
                const quarantineDir = `${FileSystem.documentDirectory}quarantine/`;
                await FileSystem.deleteAsync(quarantineDir, { idempotent: true });
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

  async isDeviceLocked(): Promise<boolean> {
    const locked = await storage.getItem('deviceLocked');
    return locked === 'true';
  }

  async getLockMessage(): Promise<string> {
    return await storage.getItem('lockMessage') || 'Device is locked';
  }

  async unlockDevice() {
    this.isLocked = false;
    await storage.removeItem('deviceLocked');
    await storage.removeItem('lockMessage');
    await storage.removeItem('lockPhoneNumber');
  }
}

export const antiTheftService = new AntiTheftService();