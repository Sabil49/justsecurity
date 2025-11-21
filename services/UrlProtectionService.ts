// services/UrlProtectionService.ts
import { Linking } from 'react-native';
import { Alert } from 'react-native';
import { api } from './api';

class UrlProtectionService {
  private readonly SAFE_CACHE_DURATION = 3600 * 24; // 24 hours
  private urlCache = new Map<string, boolean>();

  async checkUrl(url: string): Promise<{
    isSafe: boolean;
    category?: string;
    reason?: string;
  }> {
    // Check cache first
    const cached = this.urlCache.get(url);
    if (cached !== undefined) {
      return { isSafe: cached };
    }

    try {
      // Call backend URL classification API
      const response = await api.post('/url/classify', { url });

      const { isSafe, category, reason } = response.data;

      // Cache result
      this.urlCache.set(url, isSafe);

      // Clear cache after duration
      setTimeout(() => {
        this.urlCache.delete(url);
      }, this.SAFE_CACHE_DURATION * 1000);

      return { isSafe, category, reason };
    } catch (error) {
      console.error('[URL_CHECK_ERROR]', error);
      // Default to safe on error (don't block user)
      return { isSafe: true };
    }
  }

  async safeOpenUrl(url: string): Promise<void> {
    const check = await this.checkUrl(url);

    if (!check.isSafe) {
      Alert.alert(
        'Potentially Unsafe Link',
        `This link may be dangerous (${check.category}): ${check.reason}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Anyway',
            onPress: () => Linking.openURL(url),
            style: 'destructive',
          },
        ]
      );
    } else {
      await Linking.openURL(url);
    }
  }
}

export const urlProtectionService = new UrlProtectionService();