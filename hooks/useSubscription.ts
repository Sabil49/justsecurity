// hooks/useSubscription.ts
import { apiClient } from '@/lib/api-client';
import {
  getSubscriptionExpiry,
  getSubscriptionTier,
  isSubscriptionExpired,
  setSubscription
} from '@/utils/storage';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export type SubscriptionTier = 'FREE' | 'PREMIUM';

export interface SubscriptionInfo {
  id?: string;
  tier: SubscriptionTier;
  startDate: string | null;
  expiryDate: string | null;
  isTrialPeriod: boolean;
  autoRenew: boolean;
  isExpired: boolean;
  status?: string;
}

export interface SubscriptionContextType {
  subscription: SubscriptionInfo | null;
  loading: boolean;
  error: string | null;
  isPremium: boolean;
  refreshSubscription: () => Promise<void>;
  purchaseSubscription: (platform: 'GOOGLE_PLAY' | 'APP_STORE') => Promise<void>;
  restorePurchases: () => Promise<void>;
  cancelSubscription: () => Promise<void>;
}

export const useSubscription = () => {
  const { user, getIdToken } = useAuth();
  const [subscription, setSubscriptionState] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load subscription info from storage and backend
   */
  useEffect(() => {
    const loadSubscription = async () => {
      if (!user) {
        setSubscriptionState({
          tier: 'FREE',
          startDate: null,
          expiryDate: null,
          isTrialPeriod: false,
          autoRenew: false,
          isExpired: true,
        });
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Get local subscription info first
        const localTier = await getSubscriptionTier();
        const localExpiryDate = await getSubscriptionExpiry();
        const localExpired = await isSubscriptionExpired();

        // Try to sync with backend
        try {
          const token = await getIdToken();
          
          if (token) {
            const response = await apiClient.get('/subscription/info', {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            const backendSub = response.data.subscription;

            // Update local storage with backend data
            if (backendSub.tier) {
              await setSubscription(
                backendSub.tier,
                backendSub.expiryDate
              );
            }

            setSubscriptionState({
              id: backendSub.id,
              tier: backendSub.tier || 'FREE',
              startDate: backendSub.startDate || null,
              expiryDate: backendSub.expiryDate || null,
              isTrialPeriod: backendSub.isTrialPeriod || false,
              autoRenew: backendSub.autoRenew !== false,
              isExpired: backendSub.isExpired || false,
              status: backendSub.status,
            });

            console.log('[SUBSCRIPTION_SYNCED]', backendSub.tier);
          }
        } catch (syncError) {
          // Backend sync failed, use local data
          console.warn('[SUBSCRIPTION_SYNC_ERROR]', syncError);

          setSubscriptionState({
            tier: localTier as SubscriptionTier,
            startDate: null,
            expiryDate: localExpiryDate,
            isTrialPeriod: false,
            autoRenew: false,
            isExpired: localExpired,
          });
        }
      } catch (err) {
        console.error('[LOAD_SUBSCRIPTION_ERROR]', err);
        setError('Failed to load subscription');

        // Default to FREE tier on error
        setSubscriptionState({
          tier: 'FREE',
          startDate: null,
          expiryDate: null,
          isTrialPeriod: false,
          autoRenew: false,
          isExpired: true,
        });
      } finally {
        setLoading(false);
      }
    };

    loadSubscription();
  }, [user, getIdToken]);

  /**
   * Refresh subscription status from backend
   */
  const refreshSubscription = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const token = await getIdToken();
      
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await apiClient.get('/subscription/info', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const backendSub = response.data.subscription;

      // Update local storage
      if (backendSub.tier) {
        await setSubscription(backendSub.tier, backendSub.expiryDate);
      }

      setSubscriptionState({
        id: backendSub.id,
        tier: backendSub.tier || 'FREE',
        startDate: backendSub.startDate || null,
        expiryDate: backendSub.expiryDate || null,
        isTrialPeriod: backendSub.isTrialPeriod || false,
        autoRenew: backendSub.autoRenew !== false,
        isExpired: backendSub.isExpired || false,
        status: backendSub.status,
      });

      console.log('[SUBSCRIPTION_REFRESHED]', backendSub.tier);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to refresh subscription';
      setError(errorMessage);
      console.error('[REFRESH_SUBSCRIPTION_ERROR]', errorMessage);
    } finally {
      setLoading(false);
    }
  }, [user, getIdToken]);

  /**
   * Purchase subscription (initiates in-app purchase)
   */
  const purchaseSubscription = useCallback(
    async (platform: 'GOOGLE_PLAY' | 'APP_STORE') => {
      if (!user) {
        throw new Error('Not authenticated');
      }

      try {
        setLoading(true);
        setError(null);

        // Initiate purchase with platform
        const purchaseToken = await initiatePlatformPurchase(platform);

        if (!purchaseToken) {
          throw new Error('Purchase cancelled or failed');
        }

        // Verify purchase on backend
        const token = await getIdToken();
        
        if (!token) {
          throw new Error('Not authenticated');
        }

        const response = await apiClient.post(
          '/payment/verify',
          {
            platform,
            purchaseToken,
            productId: 'premium_monthly',
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const subscription = response.data.subscription;

        // Update local storage
        await setSubscription(subscription.tier, subscription.expiryDate);

        setSubscriptionState({
          id: subscription.id,
          tier: subscription.tier || 'PREMIUM',
          startDate: subscription.startDate || null,
          expiryDate: subscription.expiryDate || null,
          isTrialPeriod: subscription.isTrialPeriod || false,
           autoRenew: subscription.autoRenew !== false,
          isExpired: subscription.isExpired || false,
          status: subscription.status,
        });

        console.log('[SUBSCRIPTION_PURCHASED]', platform);
      } catch (err: any) {
        const errorMessage = err?.message || 'Purchase failed';
        setError(errorMessage);
        console.error('[PURCHASE_SUBSCRIPTION_ERROR]', errorMessage);
        throw new Error(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [user, getIdToken]
  );

  /**
   * Restore previous purchases
   */
  const restorePurchases = useCallback(async () => {
    if (!user) {
      throw new Error('Not authenticated');
    }

    try {
      setLoading(true);
      setError(null);

      const token = await getIdToken();
      
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Call backend to restore purchases
      const response = await apiClient.post(
        '/payment/restore',
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const subscription = response.data.subscription;

      // Update local storage
      await setSubscription(subscription.tier, subscription.expiryDate);

      setSubscriptionState({
        id: subscription.id,
        tier: subscription.tier || 'FREE',
        startDate: subscription.startDate || null,
        expiryDate: subscription.expiryDate || null,
        isTrialPeriod: subscription.isTrialPeriod || false,
        autoRenew: subscription.autoRenew !== false,
        isExpired: subscription.isExpired || false,
        status: subscription.status,
      });

      console.log('[PURCHASES_RESTORED]', subscription.tier);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to restore purchases';
      setError(errorMessage);
      console.error('[RESTORE_PURCHASES_ERROR]', errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [user, getIdToken]);

  /**
   * Cancel subscription
   */
  const cancelSubscription = useCallback(async () => {
    if (!user) {
      throw new Error('Not authenticated');
    }

    try {
      setLoading(true);
      setError(null);

      const token = await getIdToken();
      
      if (!token) {
        throw new Error('Not authenticated');
      }

      await apiClient.post(
        '/subscription/cancel',
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // Revert to FREE tier
      await setSubscription('FREE');

      setSubscriptionState({
        tier: 'FREE',
        startDate: null,
        expiryDate: null,
        isTrialPeriod: false,
        autoRenew: false,
        isExpired: true,
      });

      console.log('[SUBSCRIPTION_CANCELLED]');
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to cancel subscription';
      setError(errorMessage);
      console.error('[CANCEL_SUBSCRIPTION_ERROR]', errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [user, getIdToken]);

  return {
    subscription,
    loading,
    error,
    isPremium: subscription?.tier === 'PREMIUM' && !subscription?.isExpired,
    refreshSubscription,
    purchaseSubscription,
    restorePurchases,
    cancelSubscription,
  };
};

/**
 * Platform-specific purchase initiation
 * Integrate with react-native-purchases or expo-in-app-purchases
 */
async function initiatePlatformPurchase(platform: 'GOOGLE_PLAY' | 'APP_STORE'): Promise<string | null> {
  try {
    // TODO: Implement with actual in-app purchase library
    // Example using Purchases (react-native-purchases):
    /*
    import Purchases from 'react-native-purchases';

    if (platform === 'GOOGLE_PLAY') {
      Purchases.configure({
        googleAPIKey: process.env.GOOGLE_PLAY_API_KEY!,
      });
    } else if (platform === 'APP_STORE') {
      Purchases.configure({
        apiKey: process.env.REVENUECAT_API_KEY!,
      });
    }

    const offerings = await Purchases.getOfferings();
    if (offerings.current?.availablePackages.length) {
      const package = offerings.current.availablePackages[0];
      const { productIdentifier } = await Purchases.purchasePackage(package);
      return productIdentifier;
    }
    */

    console.warn('[PURCHASE_NOT_IMPLEMENTED]', platform);
    return null;
  } catch (error) {
    console.error('[INITIATE_PURCHASE_ERROR]', error);
    return null;
  }
}