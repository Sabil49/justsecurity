// Mobile error handling
import * as Sentry from 'sentry-expo';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: 1.0,
  integrations: [
    new Sentry.Native.ReactNativeTracing(),
  ],
});