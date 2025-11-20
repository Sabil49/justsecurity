// lib/api-client.ts
import { clearAuthTokens, getIdToken, setAuthTokens, STORAGE_KEYS } from '@/utils/storage';
import axios, {
    AxiosError,
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';

/**
 * Custom error type for API errors
 */
export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * API Client Configuration
 */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Create and configure Axios instance
 */
const createAxiosInstance = (): AxiosInstance => {
  const instance = axios.create({
    baseURL: API_BASE_URL,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  return instance;
};

// Create initial instance
let axiosInstance = createAxiosInstance();
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: any) => void;
}> = [];

/**
 * Process queued requests after token refresh
 */
const processQueue = (error: any, token?: string | null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });

  isRefreshing = false;
  failedQueue = [];
};

/**
 * Request Interceptor: Add Authorization Header
 */
axiosInstance.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    try {
      // Get stored ID token
      const token = await getIdToken();

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // Add request ID for tracing
      config.headers['X-Request-ID'] = generateRequestId();

      // Log request in development
      if (__DEV__) {
        console.log(`[API_REQUEST] ${config.method?.toUpperCase()} ${config.url}`, {
          params: config.params,
          data: config.data,
        });
      }

      return config;
    } catch (error) {
      console.error('[REQUEST_INTERCEPTOR_ERROR]', error);
      return config;
    }
  },
  (error) => {
    console.error('[REQUEST_INTERCEPTOR_REJECT]', error);
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor: Handle Responses & Errors
 */
axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => {
    // Log response in development
    if (__DEV__) {
      console.log(`[API_RESPONSE] ${response.status} ${response.config.url}`, {
        data: response.data,
      });
    }

    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig | undefined;

    if (!config) {
      return Promise.reject(new APIError(0, 'NO_CONFIG', 'Request configuration missing'));
    }

    // Extract error information
    const status = error.response?.status || 0;
    const errorData = error.response?.data as any;
    const message = errorData?.error || errorData?.message || error.message;
    const code = errorData?.code || 'UNKNOWN_ERROR';

    console.error(`[API_ERROR] ${status} ${config.url}`, {
      error: message,
      code,
      details: errorData?.details,
    });

    // Handle specific status codes
    switch (status) {
      case 401: // Unauthorized
        return handleUnauthorized(config, error);

      case 403: // Forbidden
        return Promise.reject(
          new APIError(403, 'FORBIDDEN', 'Access forbidden', errorData?.details)
        );

      case 404: // Not Found
        return Promise.reject(
          new APIError(404, 'NOT_FOUND', 'Resource not found', errorData?.details)
        );

      case 429: // Too Many Requests
        return handleRateLimit(config, error);

      case 500: // Internal Server Error
      case 502: // Bad Gateway
      case 503: // Service Unavailable
        return handleServerError(config, error);

      default:
        return Promise.reject(
          new APIError(
            status,
            code,
            message || 'Request failed',
            errorData?.details
          )
        );
    }
  }
);

/**
 * Handle 401 Unauthorized - Attempt Token Refresh
 */
async function handleUnauthorized(
  config: InternalAxiosRequestConfig,
  error: AxiosError
) {
  const originalRequest = config;

  // Prevent infinite loop on token refresh endpoint
  if (
    config.url?.includes('/auth/refresh') ||
    config.url?.includes('/auth/login') ||
    config.url?.includes('/auth/signup')
  ) {
    // Clear auth and redirect to login
    await clearAuthTokens();
    console.log('[AUTH_EXPIRED] Clearing tokens');
    return Promise.reject(
      new APIError(401, 'TOKEN_EXPIRED', 'Authentication expired. Please log in again.')
    );
  }

  // If already refreshing, queue the request
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({
        resolve: (token: string) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(axiosInstance(originalRequest));
        },
        reject: (err) => {
          reject(err);
        },
      });
    });
  }

  isRefreshing = true;

  try {
    // Attempt to refresh token
    const refreshToken = await SecureStore.getItemAsync(STORAGE_KEYS.FIREBASE_REFRESH_TOKEN);

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await axiosInstance.post('/auth/refresh', {
      refreshToken,
    });

    const { idToken, refreshToken: newRefreshToken } = response.data;

    // Update stored tokens
    await setAuthTokens(idToken, newRefreshToken);

    // Update Authorization header for original request
    originalRequest.headers.Authorization = `Bearer ${idToken}`;

    // Process queued requests
    processQueue(null, idToken);

    console.log('[TOKEN_REFRESHED]');
    return axiosInstance(originalRequest);
  } catch (refreshError) {
    // Refresh failed - clear auth and reject
    await clearAuthTokens();
    processQueue(refreshError, null);

    console.error('[TOKEN_REFRESH_FAILED]', refreshError);
    return Promise.reject(
      new APIError(401, 'TOKEN_REFRESH_FAILED', 'Failed to refresh authentication token')
    );
  }
}

/**
 * Handle 429 Rate Limit - Exponential Backoff Retry
 */
async function handleRateLimit(
  config: InternalAxiosRequestConfig,
  error: AxiosError
) {
  const retryCount = (config as any).retryCount || 0;

  if (retryCount < MAX_RETRIES) {
    const delay = RETRY_DELAY * Math.pow(2, retryCount);
    (config as any).retryCount = retryCount + 1;

    console.warn(`[RATE_LIMITED] Retrying after ${delay}ms (attempt ${retryCount + 1})`);

    await new Promise(resolve => setTimeout(resolve, delay));
    return axiosInstance(config);
  }

  return Promise.reject(
    new APIError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.')
  );
}

/**
 * Handle 5xx Server Errors - Automatic Retry
 */
async function handleServerError(
  config: InternalAxiosRequestConfig,
  error: AxiosError
) {
  const retryCount = (config as any).retryCount || 0;

  if (retryCount < MAX_RETRIES) {
    const delay = RETRY_DELAY * Math.pow(2, retryCount);
    (config as any).retryCount = retryCount + 1;

    console.warn(
      `[SERVER_ERROR] Retrying after ${delay}ms (attempt ${retryCount + 1})`
    );

    await new Promise(resolve => setTimeout(resolve, delay));
    return axiosInstance(config);
  }

  return Promise.reject(
    new APIError(
      error.response?.status || 500,
      'SERVER_ERROR',
      'Server error. Please try again later.'
    )
  );
}

/**
 * Generate unique request ID for tracing
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Reconfigure API client (useful for changing base URL)
 */
export function reconfigureApiClient(newBaseURL: string) {
  axiosInstance = createAxiosInstance();
  axiosInstance.defaults.baseURL = newBaseURL;
  console.log('[API_CLIENT_RECONFIGURED]', newBaseURL);
}

/**
 * Get current API base URL
 */
export function getApiBaseUrl(): string {
  return axiosInstance.defaults.baseURL || API_BASE_URL;
}

/**
 * Wrapper functions for common HTTP methods with better typing
 */

interface RequestOptions extends AxiosRequestConfig {
  retryCount?: number;
}

/**
 * GET request
 */
export async function get<T = any>(
  url: string,
  config?: RequestOptions
): Promise<AxiosResponse<T>> {
  try {
    return await axiosInstance.get<T>(url, config);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * POST request
 */
export async function post<T = any>(
  url: string,
  data?: any,
  config?: RequestOptions
): Promise<AxiosResponse<T>> {
  try {
    return await axiosInstance.post<T>(url, data, config);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * PUT request
 */
export async function put<T = any>(
  url: string,
  data?: any,
  config?: RequestOptions
): Promise<AxiosResponse<T>> {
  try {
    return await axiosInstance.put<T>(url, data, config);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * PATCH request
 */
export async function patch<T = any>(
  url: string,
  data?: any,
  config?: RequestOptions
): Promise<AxiosResponse<T>> {
  try {
    return await axiosInstance.patch<T>(url, data, config);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * DELETE request
 */
export async function del<T = any>(
  url: string,
  config?: RequestOptions
): Promise<AxiosResponse<T>> {
  try {
    return await axiosInstance.delete<T>(url, config);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Convert any error to APIError
 */
function handleApiError(error: any): APIError {
  if (error instanceof APIError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 0;
    const errorData = error.response?.data as any;
    const message = errorData?.error || errorData?.message || error.message;
    const code = errorData?.code || 'UNKNOWN_ERROR';

    return new APIError(status, code, message, errorData?.details);
  }

  return new APIError(0, 'UNKNOWN_ERROR', error?.message || 'An unknown error occurred');
}

/**
 * Main apiClient export with all methods
 */
export const apiClient = {
  // HTTP methods
  get,
  post,
  put,
  patch,
  delete: del,

  // Utilities
  setBaseURL: reconfigureApiClient,
  getBaseURL: getApiBaseUrl,

  // Raw Axios instance for advanced use cases
  instance: axiosInstance,

  // Request method with raw config
  request: (config: RequestOptions) => axiosInstance.request(config),

  // Batch requests
  all: (requests: Promise<any>[]) => Promise.all(requests),
  race: (requests: Promise<any>[]) => Promise.race(requests),
};

/**
 * Type definitions for API responses
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: any;
}

/**
 * Safe API call wrapper with error handling
 */
export async function safeApiCall<T>(
  fn: () => Promise<AxiosResponse<T>>,
  fallback?: T
): Promise<T | null> {
  try {
    const response = await fn();
    return response.data;
  } catch (error) {
    console.error('[SAFE_API_CALL_ERROR]', error);
    return fallback || null;
  }
}

/**
 * Development helper - Log all API calls
 */
export function enableApiLogging() {
  const originalConsoleLog = console.log;

  console.log = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('[API_')) {
      originalConsoleLog('[API_DEBUG]', ...args);
    } else {
      originalConsoleLog(...args);
    }
  };
}