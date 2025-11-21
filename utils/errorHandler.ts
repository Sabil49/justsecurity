// utils/errorHandler.ts
import * as Sentry from 'sentry-expo';
import { Alert } from 'react-native';

export enum ErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

interface AppError {
  code: ErrorCode;
  message: string;
  statusCode?: number;
  originalError?: Error;
}

export class ErrorHandler {
  static handle(error: any): AppError {
    let appError: AppError;

    if (error.response) {
      // HTTP error response
      const { status, data } = error.response;

      switch (status) {
        case 401:
          appError = {
            code: ErrorCode.AUTH_ERROR,
            message: 'Authentication failed. Please login again.',
            statusCode: status,
            originalError: error,
          };
          break;
        case 403:
          appError = {
            code: ErrorCode.PERMISSION_ERROR,
            message: 'You do not have permission to perform this action.',
            statusCode: status,
            originalError: error,
          };
          break;
        case 404:
          appError = {
            code: ErrorCode.NOT_FOUND,
            message: data.message || 'Resource not found.',
            statusCode: status,
            originalError: error,
          };
          break;
        case 422:
          appError = {
            code: ErrorCode.VALIDATION_ERROR,
            message: data.message || 'Invalid input data.',
            statusCode: status,
            originalError: error,
          };
          break;
        case 429:
          appError = {
            code: ErrorCode.VALIDATION_ERROR,
            message: 'Too many requests. Please try again later.',
            statusCode: status,
            originalError: error,
          };
          break;
        case 500:
        case 502:
        case 503:
          appError = {
            code: ErrorCode.SERVER_ERROR,
            message: 'Server error. Please try again later.',
            statusCode: status,
            originalError: error,
          };
          break;
        default:
          appError = {
            code: ErrorCode.SERVER_ERROR,
            message: data.message || 'An error occurred.',
            statusCode: status,
            originalError: error,
          };
      }
    } else if (error.request) {
      // Network error
      appError = {
        code: ErrorCode.NETWORK_ERROR,
        message: 'Network error. Please check your connection.',
        originalError: error,
      };
    } else if (error instanceof TypeError && error.message === 'Network request failed') {
      appError = {
        code: ErrorCode.NETWORK_ERROR,
        message: 'Network unavailable. Please check your connection.',
        originalError: error,
      };
    } else {
      // Unknown error
      appError = {
        code: ErrorCode.UNKNOWN_ERROR,
        message: error.message || 'An unexpected error occurred.',
        originalError: error,
      };
    }

    // Log to Sentry
    this.logError(appError);

    return appError;
  }

  static showAlert(error: AppError) {
    Alert.alert(
      'Error',
      error.message,
      [{ text: 'OK' }],
      { cancelable: false }
    );
  }

  static handleAndShow(error: any) {
    const appError = this.handle(error);
    this.showAlert(appError);
  }

  private static logError(error: AppError) {
    console.error('[APP_ERROR]', error.code, error.message);

    // Use Sentry.Native.captureException from sentry-expo which forwards to the native SDK.
    // Guard the call in case Sentry.Native is not available in some environments.
    if (Sentry && (Sentry as any).Native && typeof (Sentry as any).Native.captureException === 'function') {
      (Sentry as any).Native.captureException(error.originalError || new Error(error.message), {
        tags: {
          errorCode: error.code,
          statusCode: error.statusCode?.toString() || 'none',
        },
        extra: {
          message: error.message,
        },
      });
    } else {
      // Fallback: ensure the error is still visible in logs if Sentry isn't available.
      console.error('Sentry.captureException not available, logging error object:', error);
    }
  }
}