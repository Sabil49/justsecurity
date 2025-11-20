// hooks/useAuth.ts
import { apiClient } from '@/lib/api-client';
import {
  clearAuthTokens,
  getDeviceId as getStoredDeviceId,
  getIdToken as getStoredToken,
  getUser,
  setAuthTokens,
  setUser,
} from '@/utils/storage';
import * as Device from 'expo-device';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  signout: () => Promise<void>;
  refresh: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

export const useAuth = () => {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const initializationRef = useRef(false);

  /**
   * Initialize auth state and check for existing session
   */
  useEffect(() => {
    const initializeAuthState = async () => {
      // Prevent duplicate initialization in strict mode
      if (initializationRef.current) return;
      initializationRef.current = true;

      try {
        setLoading(true);
        setError(null);

        // Check if stored token exists
        const storedToken = await getStoredToken();
        const storedUserId = await getUser();

        if (storedToken && storedUserId) {
          // Verify token is still valid
          try {
            const response = await apiClient.get('/auth/verify', {
              headers: {
                Authorization: `Bearer ${storedToken}`,
              },
            });

            const userData: AuthUser = response.data.user;
            setUserState(userData);
            setIsAuthenticated(true);

            // Register device with backend
            await registerDevice(userData.id, storedToken);

            console.log('[AUTH_USER_AUTHENTICATED]', userData.email);
          } catch (verifyError) {
            // Token invalid or expired
            console.warn('[AUTH_TOKEN_INVALID]', verifyError);
            await clearAuthTokens();
            setUserState(null);
            setIsAuthenticated(false);
          }
        } else {
          setUserState(null);
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('[AUTH_INIT_ERROR]', err);
        setError('Failed to initialize authentication');
        setUserState(null);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    initializeAuthState();
  }, []);

  /**
   * Register device with backend after authentication
   */
  const registerDevice = useCallback(
    async (userId: string, idToken: string) => {
      try {
        const deviceId = await getStoredDeviceId();

        await apiClient.post(
          '/device/register',
          {
            deviceId,
            deviceName: Device.deviceName || 'Mobile Device',
            deviceModel: Device.modelName || undefined,
            osVersion: Platform.OS === 'ios' 
              ? Device.osVersion 
              : Platform.Version?.toString(),
            appVersion: '1.0.0', // Update from app.json
            fcmToken: undefined, // Will be set by anti-theft service
          },
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );

        console.log('[DEVICE_REGISTERED]', deviceId);
      } catch (error) {
        console.error('[DEVICE_REGISTRATION_ERROR]', error);
        // Non-critical error - don't break auth
      }
    },
    []
  );

  /**
   * Login with email and password
   */
  const login = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true);
      setError(null);

      // Validate inputs
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      // Call backend login endpoint
      const response = await apiClient.post('/auth/login', {
        email,
        password,
      });

      const { idToken, refreshToken, user: userData } = response.data;

      if (!idToken || !userData) {
        throw new Error('Invalid response from server');
      }

      // Store tokens securely
      await setAuthTokens(idToken, refreshToken);

      // Store user ID
      await setUser(userData.id);

      // Update state
      setUserState(userData);
      setIsAuthenticated(true);

      // Register device
      await registerDevice(userData.id, idToken);

      console.log('[AUTH_LOGIN_SUCCESS]', email);
    } catch (err: any) {
      const errorMessage = err?.message || 'Login failed';
      setError(errorMessage);
      console.error('[AUTH_LOGIN_ERROR]', errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [registerDevice]);

  /**
   * Sign up with email and password
   */
  const signup = useCallback(
    async (email: string, password: string, displayName: string) => {
      try {
        setLoading(true);
        setError(null);

        // Validate inputs
        if (!email || !password || !displayName) {
          throw new Error('All fields are required');
        }

        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters');
        }

        // Call backend signup endpoint
        const response = await apiClient.post('/auth/signup', {
          email,
          password,
          displayName,
        });

        const { idToken, refreshToken, user: userData } = response.data;

        if (!idToken || !userData) {
          throw new Error('Invalid response from server');
        }

        // Store tokens securely
        await setAuthTokens(idToken, refreshToken);

        // Store user ID
        await setUser(userData.id);

        // Update state
        setUserState(userData);
        setIsAuthenticated(true);

        // Register device
        await registerDevice(userData.id, idToken);

        console.log('[AUTH_SIGNUP_SUCCESS]', email);
      } catch (err: any) {
        const errorMessage = err?.message || 'Signup failed';
        setError(errorMessage);
        console.error('[AUTH_SIGNUP_ERROR]', errorMessage);
        throw new Error(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [registerDevice]
  );

  /**
   * Sign out user
   */
  const signout = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Optional: notify backend of logout
      try {
        const token = await getStoredToken();
        if (token) {
          await apiClient.post(
            '/auth/logout',
            {},
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
        }
      } catch (logoutError) {
        console.warn('[AUTH_LOGOUT_API_ERROR]', logoutError);
        // Continue even if API call fails
      }

      // Clear stored auth tokens
      await clearAuthTokens();

      setUserState(null);
      setIsAuthenticated(false);

      console.log('[AUTH_SIGNOUT_SUCCESS]');
    } catch (err: any) {
      const errorMessage = err?.message || 'Sign out failed';
      setError(errorMessage);
      console.error('[AUTH_SIGNOUT_ERROR]', errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Refresh user state and tokens
   */
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getStoredToken();

      if (!token) {
        throw new Error('No authentication token');
      }

      // Verify token with backend
      const response = await apiClient.get('/auth/verify', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const userData: AuthUser = response.data.user;
      setUserState(userData);
      setIsAuthenticated(true);

      console.log('[AUTH_REFRESH_SUCCESS]');
    } catch (err: any) {
      console.error('[AUTH_REFRESH_ERROR]', err);
      
      // Token is invalid
      await clearAuthTokens();
      setUserState(null);
      setIsAuthenticated(false);
      
      setError('Failed to refresh authentication');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get valid ID token
   */
  const getIdToken = useCallback(async (): Promise<string | null> => {
    try {
      const token = await getStoredToken();
      
      if (!token) {
        return null;
      }

      // TODO: Implement token expiry check and refresh logic if needed
      // For now, return stored token as-is
      
      return token;
    } catch (error) {
      console.error('[GET_ID_TOKEN_ERROR]', error);
      return null;
    }
  }, []);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    login,
    signup,
    signout,
    refresh,
    getIdToken,
  };
};