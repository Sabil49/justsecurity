// services/ScanService.ts
import { Paths, File, Directory } from "expo-file-system/next";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { api } from "./api";

export interface ScanFile {
  uri: string;
  name: string;
  size: number;
  path: string;
}

export interface ScanResult {
  file: ScanFile;
  hash: string;
  isThreat: boolean;
  threatName?: string;
  severity?: string;
  category?: string;
}

export interface ScanProgress {
  filesScanned: number;
  totalFiles: number;
  threatsFound: number;
  currentFile?: string;
}

class ScanService {
  private readonly BATCH_SIZE = 50;
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  private isScanning = false;
  private scanCancelled = false;

  // ---------- PUBLIC API ----------

  async quickScan(onProgress?: (p: ScanProgress) => void) {
    return this.performScan("quick", onProgress);
  }

  async fullScan(onProgress?: (p: ScanProgress) => void) {
    return this.performScan("full", onProgress);
  }

  cancelScan() {
    this.scanCancelled = true;
  }

  // ---------- INTERNAL LOGIC ----------

  private async performScan(
    type: "quick" | "full",
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ScanResult[]> {
    if (this.isScanning) throw new Error("Scan already in progress");

    this.isScanning = true;
    this.scanCancelled = false;

    const startTime = Date.now();
    const results: ScanResult[] = [];
    let threatsFound = 0;

    try {
      const filesToScan = await this.getFilesToScan(type);
      const totalFiles = filesToScan.length;

      for (let i = 0; i < filesToScan.length; i += this.BATCH_SIZE) {
        if (this.scanCancelled) throw new Error("Scan cancelled by user");

        const batch = filesToScan.slice(i, i + this.BATCH_SIZE);

        const hashes = await Promise.all(batch.map((file) => this.hashFile(file)));

        const hashCheckResults = await api.post("/scan/hash-check", {
          hashes: hashes.map((h) => h.hash),
          deviceId: await this.getDeviceId(),
        });

        for (let j = 0; j < batch.length; j++) {
          const file = batch[j];
          const h = hashes[j];

          const threatData = hashCheckResults.data.results.find(
            (r: any) => r.hash === h.hash
          );

          const result: ScanResult = {
            file,
            hash: h.hash,
            isThreat: threatData?.isThreat || false,
            threatName: threatData?.threatName,
            severity: threatData?.severity,
            category: threatData?.category,
          };

          results.push(result);
          if (result.isThreat) threatsFound++;
        }

        onProgress?.({
          filesScanned: Math.min(i + this.BATCH_SIZE, totalFiles),
          totalFiles,
          threatsFound,
          currentFile: batch[batch.length - 1]?.name,
        });

        await this.delay(100);
      }

      await api.post("/scan/report", {
        deviceId: await this.getDeviceId(),
        scanType: type,
        status: "completed",
        filesScanned: totalFiles,
        threatsFound,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(Date.now()).toISOString(),
        threats: results
          .filter((r) => r.isThreat)
          .map((r) => ({
            fileName: r.file.name,
            filePath: r.file.path,
            fileHash: r.hash,
            threatName: r.threatName!,
            severity: r.severity!,
          })),
      });

      return results;
    } finally {
      this.isScanning = false;
      this.scanCancelled = false;
    }
  }

  // ---------- FILE SCANNING ----------

  private async getFilesToScan(type: "quick" | "full"): Promise<ScanFile[]> {
    const files: ScanFile[] = [];

    if (Platform.OS === "android") {
      const directories =
        type === "quick"
          ? [(Paths as any).documentDirectory, (Paths as any).cacheDirectory]
          : await this.getAndroidScanDirectories();

      for (const dir of directories) {
        await this.scanDirectory(dir, files, type === "full");
      }
    } else {
      const dirs = [(Paths as any).documentDirectory, (Paths as any).cacheDirectory];
      for (const d of dirs) await this.scanDirectory(d, files, type === "full");
    }

    return files;
  }

  private async getAndroidScanDirectories(): Promise<Directory[]> {
    // ❗ SAF not yet supported in NEXT FS. Only scanning sandbox.
    return [(Paths as any).documentDirectory, (Paths as any).cacheDirectory];
  }

  private async scanDirectory(
    directory: Directory,
    files: ScanFile[],
    recursive: boolean
  ) {
    try {
      const entries = await (directory as any).readAsync();

      for (const entry of entries) {
        const entryPath = Paths.join(directory, entry.name);

        if (entry.type === "directory" && recursive) {
          await this.scanDirectory(entryPath as unknown as Directory, files, recursive);
        } else if (entry.type === "file") {
          // use static API instead of instance methods (expo typings may not expose instance APIs)
          const info = await (File as any).getInfoAsync(entryPath);

          if (info.size && info.size <= this.MAX_FILE_SIZE) {
            files.push({
              uri: entryPath,
              path: entryPath,
              name: entry.name,
              size: info.size,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[SCAN_DIRECTORY_ERROR]", directory, err);
    }
  }

  // ---------- HASHING ----------

  private async hashFile(file: ScanFile) {
    try {
      // read file contents as base64 using the static API
      const base64 = await (File as any).readAsStringAsync(file.uri, "base64");

      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        base64,
        { encoding: Crypto.CryptoEncoding.HEX }
      );

      return { file, hash };
    } catch (err) {
      console.error("[HASH_FILE_ERROR]", file.name, err);
      return { file, hash: "" };
    }
  }

  // ---------- UTILITIES ----------

  private async getDeviceId() {
    const { storage } = await import("../utils/storage");
    return storage.getDeviceId();
  }

  private delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// Singleton instance
export const scanService = new ScanService();
export { ScanService };
