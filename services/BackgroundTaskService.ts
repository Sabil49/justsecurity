// services/BackgroundTaskService.ts
import * as TaskManager from 'expo-task-manager';
import { scanService } from './ScanService';
import { notificationService } from './NotificationService';
import { telemetryService } from './TelemetryService';

const PERIODIC_SCAN_TASK = 'PERIODIC_SCAN_TASK';
const TELEMETRY_SYNC_TASK = 'TELEMETRY_SYNC_TASK';

// Task results (equivalent to BackgroundFetchResult)
const TaskResult = {
  NewData: 'newData',
  NoData: 'noData',
  Failed: 'failed',
} as const;

TaskManager.defineTask(PERIODIC_SCAN_TASK, async () => {
  try {
    console.log('[BACKGROUND_TASK] Starting periodic scan...');

    const results = await scanService.quickScan();
    const threatsFound = results.filter(r => r.isThreat).length;

    if (threatsFound > 0) {
      // Send notification
      await notificationService.sendThreatNotification(threatsFound);
    }

    return TaskResult.NewData;
  } catch (error) {
    console.error('[BACKGROUND_TASK_ERROR]', error);
    return TaskResult.Failed;
  }
});

TaskManager.defineTask(TELEMETRY_SYNC_TASK, async () => {
  try {
    console.log('[BACKGROUND_TASK] Syncing telemetry...');

    await (telemetryService as any).syncPendingEvents();

    return TaskResult.NewData;
  } catch (error) {
    console.error('[TELEMETRY_SYNC_ERROR]', error);
    return TaskResult.Failed;
  }
});

class BackgroundTaskService {
  async registerBackgroundTasks() {
    try {
      // Check if tasks are already defined
      const isScanTaskDefined = await TaskManager.isTaskDefined(PERIODIC_SCAN_TASK);
      const isTelemetryTaskDefined = await TaskManager.isTaskDefined(TELEMETRY_SYNC_TASK);

      if (!isScanTaskDefined || !isTelemetryTaskDefined) {
        console.log('[BACKGROUND_TASKS] Tasks are defined via TaskManager.defineTask');
        console.log('[BACKGROUND_TASKS] Background task execution depends on OS scheduling');
      }
    } catch (error) {
      console.error('[REGISTER_BACKGROUND_TASKS_ERROR]', error);
    }
  }

  async unregisterBackgroundTasks() {
    try {
      // TaskManager doesn't have an unregister method - tasks persist
      // To effectively disable, you would need to manage task state differently
      console.log('[BACKGROUND_TASKS] Tasks defined via TaskManager persist');
      console.log('[BACKGROUND_TASKS] Consider managing task execution via app state');
    } catch (error) {
      console.error('[UNREGISTER_BACKGROUND_TASKS_ERROR]', error);
    }
  }
}

export const backgroundTaskService = new BackgroundTaskService();