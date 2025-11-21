// hooks/usePermissionsScanner.ts
import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import PackageManagerModule from '../modules/PackageManagerModule';

export interface AppPermission {
  appName: string;
  packageName: string;
  permissions: string[];
  riskyPermissions: string[];
  riskLevel: 'high' | 'medium' | 'low';
}

const RISKY_PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_SMS',
  'android.permission.SEND_SMS',
  'android.permission.CALL_PHONE',
  'android.permission.READ_CALL_LOG',
];

export function usePermissionsScanner() {
  const [loading, setLoading] = useState(false);
  const [apps, setApps] = useState<AppPermission[]>([]);
  const [riskyApps, setRiskyApps] = useState<AppPermission[]>([]);

  const scanPermissions = async () => {
    if (Platform.OS !== 'android') {
      // iOS doesn't allow querying other apps' permissions
      console.warn('Permission scanning only available on Android');
      return;
    }

    setLoading(true);

    try {
      // Note: This requires a native module to access PackageManager
      // Placeholder implementation
      const installedApps = await getInstalledApps();
      
      const appsWithPermissions: AppPermission[] = installedApps.map(app => {
        const riskyPerms = app.permissions.filter(p => 
          RISKY_PERMISSIONS.includes(p)
        );

        return {
          ...app,
          riskyPermissions: riskyPerms,
          riskLevel: getRiskLevel(riskyPerms.length),
        };
      });

      setApps(appsWithPermissions);
      setRiskyApps(appsWithPermissions.filter(app => app.riskLevel === 'high'));
    } catch (error) {
      console.error('[PERMISSION_SCAN_ERROR]', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    scanPermissions();
  }, []);

  return {
    loading,
    apps,
    riskyApps,
    scanPermissions,
  };
}

// Placeholder - requires native module
async function getInstalledApps(): Promise<AppPermission[]> {
   const nativeApps = await PackageManagerModule.getInstalledApps();

  return nativeApps.map(app => ({
    appName: app.appName,
    packageName: app.packageName,
    permissions: app.permissions || [],
    riskyPermissions: [],
    riskLevel: "low",
  }));
}

function getRiskLevel(riskyPermCount: number): 'high' | 'medium' | 'low' {
  if (riskyPermCount >= 3) return 'high';
  if (riskyPermCount >= 1) return 'medium';
  return 'low';
}