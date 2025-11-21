// utils/deviceSafety.ts
import { Platform } from 'react-native';

export async function checkDeviceSafety(): Promise<{
  isSafe: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];

  if (Platform.OS === 'android') {
    const isRooted = await checkAndroidRoot();
    if (isRooted) {
      warnings.push('Device appears to be rooted');
    }
  } else if (Platform.OS === 'ios') {
    const isJailbroken = await checkIOSJailbreak();
    if (isJailbroken) {
      warnings.push('Device appears to be jailbroken');
    }
  }

  return {
    isSafe: warnings.length === 0,
    warnings,
  };
}

async function checkAndroidRoot(): Promise<boolean> {
  // Check for common root indicators
  const rootIndicators = [
    '/system/bin/su',
    '/system/xbin/su',
    '/data/local/xbin/su',
    '/data/local/bin/su',
    '/system/app/Superuser.apk',
  ];

  // This would require a native module to check filesystem
  // For now, return false (implement with react-native-root-detector-js)
  return false;
}

async function checkIOSJailbreak(): Promise<boolean> {
  // iOS jailbreak detection
  const jailbreakIndicators = [
    '/Applications/Cydia.app',
    '/Applications/blackra1n.app',
    '/Applications/FakeCarrier.app',
  ];

  // This would require native code
  return false;
}