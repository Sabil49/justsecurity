// services/TelemetryService.ts
import { api } from './api';
import { storage } from '../utils/storage';

interface TelemetryEvent {
  eventType: string;
  eventData: Record<string, any>;
  timestamp: string;
}

class TelemetryService {
  private readonly BATCH_SIZE = 20;
  private readonly FLUSH_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private eventQueue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  initialize() {
    // Auto-flush events periodically
    this.flushTimer = setInterval(() => {
      this.flushEvents();
    }, this.FLUSH_INTERVAL);
  }

  async logEvent(eventType: string, eventData: Record<string, any>): Promise<void> {
    try {
      // Redact PII before logging
      const sanitizedData = this.redactPII(eventData);

      const event: TelemetryEvent = {
        eventType,
        eventData: sanitizedData,
        timestamp: new Date().toISOString(),
      };

      this.eventQueue.push(event);

      // Flush if batch size reached
      if (this.eventQueue.length >= this.BATCH_SIZE) {
        await this.flushEvents();
      }
    } catch (error) {
      console.error('[TELEMETRY_LOG_ERROR]', error);
    }
  }

  async flushEvents(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    try {
      const eventsToSend = this.eventQueue.slice(0, this.BATCH_SIZE);

      await api.post('/telemetry/batch', {
        events: eventsToSend,
        deviceId: await storage.getDeviceId(),
      });

      // Remove sent events from queue
      this.eventQueue = this.eventQueue.slice(this.BATCH_SIZE);

      console.log(`[TELEMETRY] Flushed ${eventsToSend.length} events`);
    } catch (error) {
      console.error('[TELEMETRY_FLUSH_ERROR]', error);
      // Keep events in queue for retry
    }
  }

  private redactPII(data: Record<string, any>): Record<string, any> {
    const redacted = { ...data };

    // List of PII fields to redact
    const piiFields = [
      'email',
      'phone',
      'phoneNumber',
      'address',
      'ssn',
      'creditCard',
      'name',
      'userId',
      'deviceId',
      'imei',
      'imsi',
      'mac',
      'macAddress',
    ];

    for (const field of piiFields) {
      if (field in redacted) {
        redacted[field] = '[REDACTED]';
      }
    }

    return redacted;
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Final flush
    this.flushEvents();
  }
}

export const telemetryService = new TelemetryService();