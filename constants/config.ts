// constants/config.ts
export const API_CONFIG = {
  BASE_URL: process.env.EXPO_PUBLIC_API_URL || 'https://api.antivirus.app',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
};

export const SCAN_CONFIG = {
  QUICK_SCAN_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  FULL_SCAN_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  BATCH_SIZE: 50,
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
};

export const SECURITY_CONFIG = {
  JWT_EXPIRY: 7 * 24 * 60 * 60 * 1000, // 7 days
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  RATE_LIMIT_WINDOW: 60, // seconds
  RATE_LIMIT_MAX_REQUESTS: 100,
};

export const UI_CONFIG = {
  ANIMATION_DURATION: 300,
  COLORS: {
    PRIMARY: '#2ecc71',
    SECONDARY: '#3498db',
    DANGER: '#e74c3c',
    WARNING: '#f39c12',
    BACKGROUND: '#2c3e50',
    SURFACE: '#34495e',
    TEXT: '#ecf0f1',
    TEXT_SECONDARY: '#95a5a6',
  },
};

export const FEATURES = {
  QUICK_SCAN: true,
  FULL_SCAN: true,
  QUARANTINE: true,
  ANTI_THEFT: true,
  PERMISSIONS_SCAN: true,
  WIFI_SCAN: true,
  PERFORMANCE_TOOLS: true,
  PREMIUM_ONLY: ['AUTO_SCAN', 'ADVANCED_PROTECTION', 'PRIORITY_SUPPORT'],
};