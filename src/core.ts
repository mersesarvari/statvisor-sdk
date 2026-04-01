import type { StatvisorOptions, SdkEvent, IngestPayload, LogEvent, LogPayload } from "./types";

const DEFAULT_INGEST_URL = "https://statvisor.com/api/ingest";
const DOCS_URL = "https://statvisor.com";

function getErrorMessage(status: number, apiKey: string): string {
  const keyHint = `(key: ${apiKey.slice(0, 8)}...)`;

  switch (status) {
    case 401:
      return (
        `[statvisor] Invalid or missing API key ${keyHint}. ` +
        `Check your key in the dashboard → ${DOCS_URL}`
      );
    case 403:
      return (
        `[statvisor] Access denied ${keyHint}. Your plan may not support this. ` +
        `Upgrade at ${DOCS_URL}`
      );
    case 400:
      return (
        `[statvisor] Bad request — the event payload was rejected. ` +
        `This is likely a bug. Please report it at ${DOCS_URL}`
      );
    case 413:
      return (
        `[statvisor] Payload too large. ` +
        `Reduce your batch size or flush more frequently. See ${DOCS_URL}`
      );
    case 429:
      return (
        `[statvisor] Rate limit exceeded ${keyHint}. ` +
        `Events are being dropped. Reduce flush frequency or upgrade at ${DOCS_URL}`
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return (
        `[statvisor] Server error (HTTP ${status}). ` +
        `Events may have been lost. Check status at ${DOCS_URL}`
      );
    default:
      return (
        `[statvisor] Unexpected response (HTTP ${status}). ` +
        `See ${DOCS_URL} for help.`
      );
  }
}
const DEFAULT_FLUSH_INTERVAL = 5000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LOG_INGEST_URL = "https://statvisor.com/api/ingest/logs";

export class BatchQueue {
  private queue: SdkEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private options: Required<StatvisorOptions>;

  constructor(options: StatvisorOptions) {
    this.options = {
      apiKey: options.apiKey,
      ingestUrl: options.ingestUrl ?? DEFAULT_INGEST_URL,
      flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      debug: options.debug ?? false,
      ignoreRoutes: options.ignoreRoutes ?? [],
      environment:
        options.environment ??
        (typeof process !== "undefined" ? process.env.NODE_ENV : undefined) ??
        "production",
    };

    this.timer = setInterval(() => {
      this.flush().catch(() => undefined);
    }, this.options.flushInterval);

    // Allow process to exit even if timer is active
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  push(event: SdkEvent): void {
    // Check ignored routes
    for (const ignored of this.options.ignoreRoutes) {
      if (event.route === ignored || event.route.startsWith(ignored)) return;
    }

    this.queue.push(event);

    if (this.options.debug) {
      console.log(
        `[statvisor] queued event: ${event.method} ${event.route} ${event.status_code} ${event.duration_ms}ms (queue=${this.queue.length})`
      );
    }

    if (this.queue.length >= this.options.batchSize) {
      this.flush().catch(() => undefined);
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);

    if (this.options.debug) {
      console.log(`[statvisor] flushing ${batch.length} events to ${this.options.ingestUrl}`);
    }

    const payload: IngestPayload = { events: batch };

    try {
      const response = await fetch(this.options.ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.options.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        if (this.options.debug) {
          try {
            const data = await response.json() as { received?: number };
            console.log(`[statvisor] flushed successfully: received=${data.received}`);
          } catch {
            console.log(`[statvisor] flushed successfully (${batch.length} events)`);
          }
        }
      } else {
        const message = getErrorMessage(response.status, this.options.apiKey);
        console.warn(message);
      }
    } catch (err) {
      // Never throw — silently swallow network errors
      if (this.options.debug) {
        console.error("[statvisor] network error during flush:", err);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

// ---------------------------------------------------------------------------
// LogQueue — batches manual log() events and sends to /api/ingest/logs
// ---------------------------------------------------------------------------

export class LogQueue {
  private queue: LogEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private apiKey: string;
  private logIngestUrl: string;
  private flushInterval: number;

  constructor(options: StatvisorOptions) {
    this.apiKey = options.apiKey;
    this.logIngestUrl = DEFAULT_LOG_INGEST_URL;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;

    this.timer = setInterval(() => {
      this.flush().catch(() => undefined);
    }, this.flushInterval);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  push(event: LogEvent): void {
    this.queue.push(event);
    if (this.queue.length >= DEFAULT_BATCH_SIZE) {
      this.flush().catch(() => undefined);
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    const payload: LogPayload = { logs: batch };

    try {
      await fetch(this.logIngestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Never throw — silently swallow network errors
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
