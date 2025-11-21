// hooks/useSubscription.ts
import { useState, useEffect } from 'react';
import { api } from '../services/api';

interface Subscription {
  id: string;
  tier: 'free' | 'premium';
  status: 'active' | 'trial' | 'expired' | 'cancelled';
  trialEndsAt?: string;
  currentPeriodEnd?: string;
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    try {
      const response = await api.get('/subscription/current');
      setSubscription(response.data.subscription);
    } catch (error) {
      console.error('[LOAD_SUBSCRIPTION_ERROR]', error);
    } finally {
      setLoading(false);
    }
  };

  const isPremium = subscription?.tier === 'premium' && subscription?.status === 'active';
  const isTrialActive = subscription?.status === 'trial' && subscription?.trialEndsAt
    ? new Date(subscription.trialEndsAt) > new Date()
    : false;

  return { subscription, loading, isPremium, isTrialActive, refresh: loadSubscription };
}

