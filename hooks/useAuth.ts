// hooks/useAuth.ts
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { storage } from '../utils/storage';
import { api } from '../services/api';

interface User {
  id: string;
  email: string;
  name?: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await storage.getAuthToken();

      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Verify token is still valid
      try {
        const response = await api.post('/auth/verify-token', {});
        setUser(response.data.user);
      } catch (error) {
        // Token invalid, clear and redirect
        await storage.clearAuthToken();
        setUser(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auth check failed');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
      await storage.clear();
      setUser(null);
      // Use an object form and cast to any to satisfy the router.replace type for group routes
      router.replace({ pathname: '/(auth)/login' } as any);
    } catch (error) {
      console.error('[LOGOUT_ERROR]', error);
    }
  };

  return { user, loading, error, checkAuth, logout, isAuthenticated: !!user };
}

