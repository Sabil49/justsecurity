// services/usePermissionsScanner.ts
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
export interface AppPermission {
  appName: string;
  packageName: string;
  permissions: string[];
  riskyPermissions: string[];
  riskLevel: 'high' | 'medium' | 'low';
}
interface InstalledApp {
  appName: string;
  packageName: string;
  permissions: string[];
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

  const scanPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') {
      // iOS doesn't allow querying other apps' permissions
      console.warn('Permission scanning only available on Android');
      return;
    }

    setLoading(true);

    let appsWithPermissions: AppPermission[] = [];

    try {
      // Note: This requires a native module to access PackageManager
      // Placeholder implementation
      const installedApps = await getInstalledApps();
      
      appsWithPermissions = installedApps.map(app => {
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
      // If scanning fails, fall back to an empty list (or previous state)
      setRiskyApps(appsWithPermissions.filter(app => app.riskLevel !== 'low'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scanPermissions();
  }, [scanPermissions]);

  return {
    loading,
    apps,
    riskyApps,
    scanPermissions,
  };
}

// Placeholder - requires native module
async function getInstalledApps(): Promise<InstalledApp[]> {
  // This would use a native module to access Android PackageManager
  // For now, return empty array
  return [];
}

function getRiskLevel(riskyPermCount: number): 'high' | 'medium' | 'low' {
  if (riskyPermCount >= 3) return 'high';
  if (riskyPermCount >= 1) return 'medium';
  return 'low';
}