export interface StatvisorOptions {
  /** Your project API key from the Statvisor dashboard */
  apiKey: string;
  /** Ingest endpoint URL. Defaults to https://statvisor.com/api/ingest */
  ingestUrl?: string;
  /** How often to flush the event queue, in ms. Default: 5000 */
  flushInterval?: number;
  /** Max number of events before an automatic flush is triggered. Default: 50 */
  batchSize?: number;
  /** Log debug info to console. Default: false */
  debug?: boolean;
  /** Route paths to skip (exact match or prefix). E.g. ['/health', '/metrics'] */
  ignoreRoutes?: string[];
  /** Environment tag attached to events. Default: process.env.NODE_ENV */
  environment?: string;
}

export interface SdkEvent {
  route: string;
  method: string;
  status_code: number;
  duration_ms: number;
  error?: string;
  timestamp: string;
}

export interface IngestPayload {
  events: SdkEvent[];
}

export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
}

export interface LogPayload {
  logs: LogEvent[];
}
