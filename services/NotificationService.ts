// services/NotificationService.ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import { storage } from '../utils/storage';
import { api } from './api';

export interface NotificationPayload {
  type: 'threat' | 'scan_complete' | 'anti_theft' | 'update' | 'subscription' | 'system';
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: 'high' | 'normal';
  sound?: boolean;
  badge?: boolean;
}

interface NotificationHistory {
  id: string;
  payload: NotificationPayload;
  receivedAt: Date;
  actionTaken?: string;
}

class NotificationService {
  private notificationHistory: NotificationHistory[] = [];
  private readonly MAX_HISTORY = 100;
  private soundObject: Audio.Sound | null = null;

  async initialize(): Promise<void> {
    try {
      // Request permissions
      await this.requestNotificationPermissions();

      // Configure notification handling
      this.configureNotificationHandler();

      // Setup listeners for notifications
      this.setupNotificationListeners();

      console.log('[NOTIFICATION_SERVICE] Initialized successfully');
    } catch (error) {
      console.error('[NOTIFICATION_SERVICE_INIT_ERROR]', error);
    }
  }

  /**
   * Request notification permissions from user
   */
  private async requestNotificationPermissions(): Promise<boolean> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowCriticalAlerts: true,
            allowProvisional: false
          },
        });
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('[NOTIFICATION_PERMISSIONS] Permission denied');
        return false;
      }

      console.log('[NOTIFICATION_PERMISSIONS] Granted');
      return true;
    } catch (error) {
      console.error('[REQUEST_NOTIFICATION_PERMISSIONS_ERROR]', error);
      return false;
    }
  }

  /**
   * Configure how notifications are handled when app is in foreground
   */
  private configureNotificationHandler(): void {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // Safely coerce incoming data into NotificationPayload to satisfy TypeScript
        const rawData = notification.request.content.data as unknown;
        let payload: NotificationPayload;

        if (rawData && typeof rawData === 'object') {
          const d = rawData as Record<string, any>;
          payload = {
            type: (d.type as NotificationPayload['type']) ?? 'system',
            title: String(d.title ?? notification.request.content.title ?? ''),
            body: String(d.body ?? notification.request.content.body ?? ''),
            data: d.data ?? d,
            priority: (d.priority as NotificationPayload['priority']) ?? 'normal',
            sound: d.sound !== undefined ? Boolean(d.sound) : true,
            badge: d.badge !== undefined ? Boolean(d.badge) : false,
          };
        } else {
          // Fallback to notification content fields if data is not an object
          payload = {
            type: 'system',
            title: notification.request.content.title || '',
            body: notification.request.content.body || '',
            data: notification.request.content.data || {},
            priority: 'normal',
            sound: true,
            badge: false,
          };
        }

        console.log('[NOTIFICATION_RECEIVED]', payload.type);

        // Log notification
        this.addToHistory(payload);

        // Auto-handle certain notification types
        if (payload.type === 'threat') {
          await this.handleThreatNotification(payload);
        } else if (payload.type === 'anti_theft') {
          await this.handleAntiTheftNotification(payload);
        } else if (payload.type === 'scan_complete') {
          await this.handleScanCompleteNotification(payload);
        }

        // Show alert based on priority
        return {
          shouldShowAlert: true,
          shouldPlaySound: payload.sound !== false,
          shouldSetBadge: payload.badge !== false,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      },
    });
  }

  /**
   * Setup listeners for notification interactions
   */
  private setupNotificationListeners(): void {
    // Handle notification taps when app is in foreground
    this.foregroundSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[NOTIFICATION_FOREGROUND]', notification.request.content.data);
      }
    );

    // Handle notification taps when app is backgrounded/closed
    this.responseSubscription = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        // Safely coerce incoming data into NotificationPayload to satisfy TypeScript
        const rawData = response.notification.request.content.data as unknown;
        let payload: NotificationPayload;

        if (rawData && typeof rawData === 'object') {
          const d = rawData as Record<string, any>;
          payload = {
            type: (d.type as NotificationPayload['type']) ?? 'system',
            title: String(d.title ?? response.notification.request.content.title ?? ''),
            body: String(d.body ?? response.notification.request.content.body ?? ''),
            data: d.data ?? d,
            priority: (d.priority as NotificationPayload['priority']) ?? 'normal',
            sound: d.sound !== undefined ? Boolean(d.sound) : true,
            badge: d.badge !== undefined ? Boolean(d.badge) : false,
          };
        } else {
          // Fallback to notification content fields if data is not an object
          payload = {
            type: 'system',
            title: response.notification.request.content.title || '',
            body: response.notification.request.content.body || '',
            data: response.notification.request.content.data || {},
            priority: 'normal',
            sound: true,
            badge: false,
          };
        }

        console.log('[NOTIFICATION_RESPONSE]', payload.type);

        // Handle action based on notification type
        await this.handleNotificationAction(payload);
      }
    );
  }

  private foregroundSubscription: ReturnType<typeof Notifications.addNotificationReceivedListener> | null = null;
  private responseSubscription: ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null = null;

  /**
   * Send threat detection notification
   */
  async sendThreatNotification(threatCount: number, threatNames?: string[]): Promise<void> {
    try {
      const payload: NotificationPayload = {
        type: 'threat',
        title: '🚨 Threats Detected',
        body: `${threatCount} threat${threatCount !== 1 ? 's' : ''} found on your device`,
        data: {
          threatCount,
          threatNames: threatNames || [],
          action: 'open_quarantine',
        },
        priority: 'high',
        sound: true,
        badge: true,
      };

      await this.sendNotification(payload);

      // Log telemetry
      await this.logTelemetry('threat_notification_sent', {
        threatCount,
      });
    } catch (error) {
      console.error('[SEND_THREAT_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Send scan completion notification
   */
  async sendScanCompleteNotification(
    scanType: 'quick' | 'full',
    threatsFound: number,
    duration: number
  ): Promise<void> {
    try {
      const message = threatsFound > 0
        ? `Scan complete: ${threatsFound} threat${threatsFound !== 1 ? 's' : ''} found`
        : 'Scan complete: Your device is clean';

      const payload: NotificationPayload = {
        type: 'scan_complete',
        title: '✅ Scan Complete',
        body: message,
        data: {
          scanType,
          threatsFound,
          duration,
          action: threatsFound > 0 ? 'open_quarantine' : 'open_home',
        },
        priority: threatsFound > 0 ? 'high' : 'normal',
        sound: true,
        badge: false,
      };

      await this.sendNotification(payload);

      await this.logTelemetry('scan_complete_notification_sent', {
        scanType,
        threatsFound,
        duration,
      });
    } catch (error) {
      console.error('[SEND_SCAN_COMPLETE_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Send update available notification
   */
  async sendUpdateNotification(version: string, changelogUrl: string): Promise<void> {
    try {
      const payload: NotificationPayload = {
        type: 'update',
        title: '📦 Update Available',
        body: `Version ${version} is now available`,
        data: {
          version,
          changelogUrl,
          action: 'open_update',
        },
        priority: 'normal',
        sound: true,
        badge: true,
      };

      await this.sendNotification(payload);
    } catch (error) {
      console.error('[SEND_UPDATE_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Send subscription-related notification
   */
  async sendSubscriptionNotification(
    type: 'trial_ending' | 'trial_expired' | 'renewal_failed',
    daysRemaining?: number
  ): Promise<void> {
    try {
      const notificationMap = {
        trial_ending: {
          title: '⏰ Trial Ending Soon',
          body: `Your free trial ends in ${daysRemaining || 1} day(s)`,
        },
        trial_expired: {
          title: '❌ Trial Expired',
          body: 'Your free trial has expired. Upgrade to Premium for continued protection.',
        },
        renewal_failed: {
          title: '⚠️ Renewal Failed',
          body: 'Your subscription renewal failed. Please update your payment method.',
        },
      };

      const notifConfig = notificationMap[type];

      const payload: NotificationPayload = {
        type: 'subscription',
        title: notifConfig.title,
        body: notifConfig.body,
        data: {
          action: 'open_subscription',
          subType: type,
        },
        priority: 'high',
        sound: false,
        badge: true,
      };

      await this.sendNotification(payload);
    } catch (error) {
      console.error('[SEND_SUBSCRIPTION_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Send system/maintenance notification
   */
  async sendSystemNotification(message: string, action?: string): Promise<void> {
    try {
      const payload: NotificationPayload = {
        type: 'system',
        title: 'ℹ️ System Alert',
        body: message,
        data: {
          action: action || 'open_home',
        },
        priority: 'normal',
        sound: false,
        badge: false,
      };

      await this.sendNotification(payload);
    } catch (error) {
      console.error('[SEND_SYSTEM_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Handle threat notification action
   */
  private async handleThreatNotification(payload: NotificationPayload): Promise<void> {
    try {
      // Play warning sound
      if (payload.sound) {
        await this.playSound('threat');
      }

      // Vibrate device
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true },
      });

      console.log('[THREAT_NOTIFICATION_HANDLED]');
    } catch (error) {
      console.error('[HANDLE_THREAT_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Handle anti-theft notification action
   */
  private async handleAntiTheftNotification(payload: NotificationPayload): Promise<void> {
    try {
      const commandType = payload.data?.commandType;

      switch (commandType) {
        case 'ring':
          await this.playSound('ring');
          break;
        case 'lock':
          // Lock UI will be handled by app navigation
          break;
        case 'locate':
          // Location will be requested by AntiTheftService
          break;
        default:
          break;
      }

      console.log('[ANTI_THEFT_NOTIFICATION_HANDLED]', commandType);
    } catch (error) {
      console.error('[HANDLE_ANTI_THEFT_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Handle scan complete notification action
   */
  private async handleScanCompleteNotification(payload: NotificationPayload): Promise<void> {
    try {
      const threatsFound = payload.data?.threatsFound || 0;

      if (threatsFound > 0) {
        await this.playSound('alert');
      }

      console.log('[SCAN_COMPLETE_NOTIFICATION_HANDLED]');
    } catch (error) {
      console.error('[HANDLE_SCAN_COMPLETE_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Handle notification action based on type and action field
   */
  private async handleNotificationAction(payload: NotificationPayload): Promise<void> {
    try {
      const action = payload.data?.action;

      console.log('[NOTIFICATION_ACTION]', action);

      // Actions can be handled by the app's navigation system
      // Emit event that can be listened to by navigation
      if (global.notificationActionCallback) {
        global.notificationActionCallback(action, payload);
      }
    } catch (error) {
      console.error('[HANDLE_NOTIFICATION_ACTION_ERROR]', error);
    }
  }

  /**
   * Send local notification (for testing or offline scenarios)
   */
  async sendLocalNotification(payload: NotificationPayload): Promise<string> {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: payload.title,
          body: payload.body,
          data: payload.data || {},
          sound: payload.sound !== false ? 'default' : undefined,
          badge: payload.badge !== false ? 1 : undefined,
          priority: payload.priority === 'high' ? 'max' : 'default',
        },
        trigger: {
          seconds: 1, // Send immediately
        } as Notifications.NotificationTriggerInput,
      });

      console.log('[LOCAL_NOTIFICATION_SENT]', notificationId);
      return notificationId;
    } catch (error) {
      console.error('[SEND_LOCAL_NOTIFICATION_ERROR]', error);
      throw error;
    }
  }

  /**
   * Send notification via backend (for server-initiated notifications)
   */
  private async sendNotification(payload: NotificationPayload): Promise<void> {
    try {
      const deviceId = await storage.getDeviceId();

      // Log locally first
      this.addToHistory(payload);

      // Send to backend to store in database
      await api.post('/notifications/log', {
        deviceId,
        payload,
      });

      console.log('[NOTIFICATION_SENT]', payload.type);
    } catch (error) {
      console.error('[SEND_NOTIFICATION_ERROR]', error);
      // Still send local notification if backend fails
      await this.sendLocalNotification(payload);
    }
  }

  /**
   * Play notification sound
   */
  private async playSound(type: 'threat' | 'ring' | 'alert'): Promise<void> {
    try {
      // Stop any currently playing sound
      if (this.soundObject) {
        await this.soundObject.unloadAsync();
      }

      // Map sound type to asset
      const soundMap: Record<string, any> = {
        threat: require('../assets/sounds/threat.mp3'),
        ring: require('../assets/sounds/ring.mp3'),
        alert: require('../assets/sounds/alert.mp3'),
      };

      const soundAsset = soundMap[type];

      if (!soundAsset) {
        console.warn(`[PLAY_SOUND] Unknown sound type: ${type}`);
        return;
      }

      const { sound } = await Audio.Sound.createAsync(soundAsset, {
        shouldPlay: true,
        volume: 1.0,
      });

      this.soundObject = sound;

      // Unload sound after playback completes
      sound.setOnPlaybackStatusUpdate(async (status) => {
        if (status.isLoaded && status.didJustFinish) {
          await sound.unloadAsync();
          this.soundObject = null;
        }
      });

      console.log('[SOUND_PLAYED]', type);
    } catch (error) {
      console.error('[PLAY_SOUND_ERROR]', error);
    }
  }

  /**
   * Add notification to history
   */
  private addToHistory(payload: NotificationPayload): void {
    this.notificationHistory.push({
      id: `${Date.now()}-${Math.random()}`,
      payload,
      receivedAt: new Date(),
    });

    // Keep history size under control
    if (this.notificationHistory.length > this.MAX_HISTORY) {
      this.notificationHistory = this.notificationHistory.slice(-this.MAX_HISTORY);
    }
  }

  /**
   * Get notification history
   */
  getHistory(limit: number = 20): NotificationHistory[] {
    return this.notificationHistory.slice(-limit).reverse();
  }

  /**
   * Clear notification history
   */
  clearHistory(): void {
    this.notificationHistory = [];
  }

  /**
   * Get notification history filtered by type
   */
  getHistoryByType(type: NotificationPayload['type']): NotificationHistory[] {
    return this.notificationHistory.filter(n => n.payload.type === type);
  }

  /**
   * Log notification telemetry
   */
  private async logTelemetry(eventType: string, eventData: Record<string, any>): Promise<void> {
    try {
      // Import telemetry service dynamically to avoid circular dependency
      const { telemetryService } = await import('./TelemetryService');
      await telemetryService.logEvent(eventType, eventData);
    } catch (error) {
      console.error('[LOG_TELEMETRY_ERROR]', error);
    }
  }

  /**
   * Cancel scheduled notifications
   */
  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      console.log('[NOTIFICATION_CANCELLED]', notificationId);
    } catch (error) {
      console.error('[CANCEL_NOTIFICATION_ERROR]', error);
    }
  }

  /**
   * Cancel all scheduled notifications
   */
  async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      console.log('[ALL_NOTIFICATIONS_CANCELLED]');
    } catch (error) {
      console.error('[CANCEL_ALL_NOTIFICATIONS_ERROR]', error);
    }
  }

  /**
   * Get scheduled notifications
   */
  async getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('[GET_SCHEDULED_NOTIFICATIONS_ERROR]', error);
      return [];
    }
  }

  /**
   * Get app badge count
   */
  async getApplicationIconBadgeNumber(): Promise<number> {
    try {
      if (Platform.OS === 'ios') {
        return await Notifications.getLastNotificationResponseAsync()
          .then(() => 0)
          .catch(() => 0);
      }
      return 0;
    } catch (error) {
      console.error('[GET_BADGE_NUMBER_ERROR]', error);
      return 0;
    }
  }

  /**
   * Set app badge count
   */
  async setApplicationIconBadgeNumber(count: number): Promise<void> {
    try {
      if (Platform.OS === 'ios') {
        await Notifications.setBadgeCountAsync(count);
        console.log('[BADGE_SET]', count);
      }
    } catch (error) {
      console.error('[SET_BADGE_NUMBER_ERROR]', error);
    }
  }

  /**
   * Enable/disable notifications
   */
  async setNotificationsEnabled(enabled: boolean): Promise<void> {
    try {
      if (!enabled) {
        await this.cancelAllNotifications();
      }

      await storage.setItem('notificationsEnabled', enabled ? 'true' : 'false');
      console.log('[NOTIFICATIONS_ENABLED]', enabled);
    } catch (error) {
      console.error('[SET_NOTIFICATIONS_ENABLED_ERROR]', error);
    }
  }

  /**
   * Check if notifications are enabled
   */
  async areNotificationsEnabled(): Promise<boolean> {
    try {
      const enabled = await storage.getItem('notificationsEnabled');
      return enabled !== 'false'; // Default to true
    } catch (error) {
      console.error('[CHECK_NOTIFICATIONS_ENABLED_ERROR]', error);
      return true;
    }
  }

  /**
   * Cleanup and unsubscribe
   */
  destroy(): void {
    if (this.foregroundSubscription) {
      this.foregroundSubscription.remove();
    }

    if (this.responseSubscription) {
      this.responseSubscription.remove();
    }

    if (this.soundObject) {
      this.soundObject.unloadAsync();
    }

    this.notificationHistory = [];
    console.log('[NOTIFICATION_SERVICE] Destroyed');
  }
}

// Global callback for notification actions
declare global {
  var notificationActionCallback: ((action: string, payload: NotificationPayload) => void) | undefined;
}

export const notificationService = new NotificationService();