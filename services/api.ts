// services/api.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.antivirus.app';

class SimpleEventEmitter {
  private listeners: { [key: string]: Function[] } = {};

  on(event: string, cb: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(cb);
  }

  off(event: string, cb?: Function) {
    if (!this.listeners[event]) return;
    if (!cb) {
      delete this.listeners[event];
      return;
    }
    this.listeners[event] = this.listeners[event].filter(fn => fn !== cb);
  }

  emit(event: string, ...args: any[]) {
    const handlers = this.listeners[event];
    if (!handlers) return;
    handlers.forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        // ignore handler errors
      }
    });
  }
}

export const EventEmitter = new SimpleEventEmitter();

class ApiClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
    });

    // Request interceptor: Add auth token
    this.instance.interceptors.request.use(
      async (config) => {
        const token = await SecureStore.getItemAsync('authToken');
        
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: Handle 401 and refresh token
    this.instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            // Try to refresh token
            const refreshToken = await SecureStore.getItemAsync('refreshToken');
            
            if (refreshToken) {
              const response = await this.instance.post('/auth/refresh', {
                refreshToken,
              });

              const { token } = response.data;
              await SecureStore.setItemAsync('authToken', token);

              originalRequest.headers.Authorization = `Bearer ${token}`;
              return this.instance(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, clear storage and redirect to login
            await SecureStore.deleteItemAsync('authToken');
            await SecureStore.deleteItemAsync('refreshToken');
            
            // Emit logout event
            EventEmitter.emit('logout');
          }
        }

        return Promise.reject(error);
      }
    );
  }

  get<T = any>(url: string, config?: any) {
    return this.instance.get<T>(url, config);
  }

  post<T = any>(url: string, data?: any, config?: any) {
    return this.instance.post<T>(url, data, config);
  }

  put<T = any>(url: string, data?: any, config?: any) {
    return this.instance.put<T>(url, data, config);
  }

  delete<T = any>(url: string, config?: any) {
    return this.instance.delete<T>(url, config);
  }
}

export const api = new ApiClient();