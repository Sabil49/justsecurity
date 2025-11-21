import { NativeModules } from "react-native";

const { PackageManagerModule } = NativeModules;

export interface NativeAppInfo {
  appName: string;
  packageName: string;
  permissions: string[];
}

export default {
  async getInstalledApps(): Promise<NativeAppInfo[]> {
    return await PackageManagerModule.getInstalledApps();
  },
};
