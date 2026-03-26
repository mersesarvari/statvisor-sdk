/**
 * @statvisor/browser
 *
 * Drop-in browser analytics tracker. Sends page views and Core Web Vitals
 * to the Statvisor ingest endpoint. Zero dependencies — uses native
 * PerformanceObserver and sendBeacon APIs.
 *
 * Usage (Next.js App Router):
 *
 *   // components/StatvisorAnalytics.tsx
 *   "use client";
 *   import { useEffect } from "react";
 *   import { initStatvisor } from "@statvisor/browser";
 *
 *   export function StatvisorAnalytics({ frontendKey }: { frontendKey: string }) {
 *     useEffect(() => { initStatvisor({ frontendKey }); }, []);
 *     return null;
 *   }
 *
 *   // app/layout.tsx
 *   import { StatvisorAnalytics } from "@statvisor/browser/react";
 *   // ... add <StatvisorAnalytics frontendKey="vl_fe_..." /> inside <body>
 */

const DEFAULT_ENDPOINT = "https://statvisor.com/api/ingest/frontend";

type Rating = "good" | "needs-improvement" | "poor";

interface PageViewPayload {
  type: "pageview";
  path: string;
  referrer: string;
  ua: string;
  screen_w: number;
  visitor_id?: string;
  session_id?: string;
  referrer_domain?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

interface VitalPayload {
  type: "vital";
  path: string;
  metric: string;
  value: number;
  rating: Rating;
}

interface SessionPingPayload {
  type: "session_ping";
  session_id: string;
  visitor_id?: string;
  duration_ms: number;
}

type TrackPayload = PageViewPayload | VitalPayload | SessionPingPayload;

interface IngestBody {
  frontendKey: string;
  events: TrackPayload[];
}

export interface StatvisorBrowserOptions {
  /** Your Statvisor frontend key (find it in the dashboard under "Frontend Key") */
  frontendKey: string;
  /** Override the ingest endpoint. Defaults to the Statvisor hosted endpoint. */
  endpoint?: string;
}

const VITAL_THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  FCP: [1800, 3000],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  INP: [200, 500],
};

function uuidv4(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Module-level in-memory fallbacks for when Web Storage is unavailable
// (e.g. Safari ITP, cross-origin iframes, private browsing restrictions).
// These survive the lifetime of the page even when sessionStorage/localStorage throw.
let _memVisitorId = "";
let _memSessionId = "";
let _memSessionStart = 0;

function getVisitorId(): string {
  try {
    const key = "_sv_vid";
    let id = localStorage.getItem(key);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(key, id);
    }
    _memVisitorId = id;
    return id;
  } catch {
    if (!_memVisitorId) _memVisitorId = uuidv4();
    return _memVisitorId;
  }
}

function getSessionId(): string {
  try {
    const key = "_sv_sid";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = uuidv4();
      sessionStorage.setItem(key, id);
    }
    _memSessionId = id;
    return id;
  } catch {
    if (!_memSessionId) _memSessionId = uuidv4();
    return _memSessionId;
  }
}

function getSessionStart(): number {
  try {
    const key = "_sv_st";
    let ts = Number(sessionStorage.getItem(key));
    if (!ts) {
      ts = Date.now();
      sessionStorage.setItem(key, String(ts));
    }
    _memSessionStart = ts;
    return ts;
  } catch {
    // Do NOT return Date.now() here — that would make every call return a different
    // value, causing duration_ms = 0. Use a stable in-memory fallback instead.
    if (!_memSessionStart) _memSessionStart = Date.now();
    return _memSessionStart;
  }
}

function getUtmParams(): { utm_source?: string; utm_medium?: string; utm_campaign?: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    const result: { utm_source?: string; utm_medium?: string; utm_campaign?: string } = {};
    const src = params.get("utm_source");
    const med = params.get("utm_medium");
    const cam = params.get("utm_campaign");
    if (src) result.utm_source = src;
    if (med) result.utm_medium = med;
    if (cam) result.utm_campaign = cam;
    return result;
  } catch {
    return {};
  }
}

function getReferrerDomain(): string {
  try {
    const ref = document.referrer;
    if (!ref) return "";
    const refHost = new URL(ref).hostname;
    if (refHost === window.location.hostname) return "";
    return refHost;
  } catch {
    return "";
  }
}

function getRating(metric: string, value: number): Rating {
  const [good, poor] = VITAL_THRESHOLDS[metric] ?? [1000, 3000];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

function beacon(endpoint: string, body: IngestBody): void {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        endpoint,
        new Blob([data], { type: "application/json" })
      );
      return;
    }
  } catch {
    /* fall through to fetch */
  }
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data,
    keepalive: true,
    credentials: "omit",
  }).catch(() => undefined);
}

/**
 * Initialize Statvisor browser analytics. Call once per page load — ideally
 * inside a `useEffect` in your root layout component.
 */
const INIT_FLAG = "__sv_init";

export function initStatvisor(options: StatvisorBrowserOptions): void {
  if (typeof window === "undefined") return;
  // Guard against double-initialisation (React Strict Mode, HMR, duplicate script tags).
  if ((window as unknown as Record<string, unknown>)[INIT_FLAG]) return;
  (window as unknown as Record<string, unknown>)[INIT_FLAG] = true;

  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const path = window.location.pathname;
  const pending: VitalPayload[] = [];
  let flushed = false;

  function sendEvents(events: TrackPayload[]): void {
    if (events.length === 0) return;
    beacon(endpoint, { frontendKey: options.frontendKey, events });
  }

  function flush(): void {
    if (flushed) return;
    flushed = true;
    if (pending.length > 0) sendEvents([...pending]);
  }

  // ── 1. Page view ────────────────────────────────────────────────────────────
  sendEvents([
    {
      type: "pageview",
      path,
      referrer: document.referrer || "",
      ua: navigator.userAgent,
      screen_w: window.screen.width,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      referrer_domain: getReferrerDomain(),
      ...getUtmParams(),
    },
  ]);

  // ── 2. TTFB — from navigation timing (synchronous, available immediately) ──
  try {
    const [nav] = performance.getEntriesByType(
      "navigation"
    ) as PerformanceNavigationTiming[];
    if (nav) {
      const value = Math.max(0, Math.round(nav.responseStart - nav.startTime));
      if (value > 0) {
        pending.push({
          type: "vital",
          path,
          metric: "TTFB",
          value,
          rating: getRating("TTFB", value),
        });
      }
    }
  } catch {
    /* not supported */
  }

  // ── 3. FCP — first-contentful-paint ─────────────────────────────────────────
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          const value = Math.round(entry.startTime);
          pending.push({
            type: "vital",
            path,
            metric: "FCP",
            value,
            rating: getRating("FCP", value),
          });
        }
      }
    }).observe({ type: "paint", buffered: true });
  } catch {
    /* not supported */
  }

  // ── 4. LCP — largest-contentful-paint ───────────────────────────────────────
  try {
    let lastLcpValue = 0;

    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lastLcpValue = Math.round(last.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });

    // LCP is finalized on first user interaction or page hide
    const finalizeLcp = () => {
      if (lastLcpValue > 0) {
        pending.push({
          type: "vital",
          path,
          metric: "LCP",
          value: lastLcpValue,
          rating: getRating("LCP", lastLcpValue),
        });
        lastLcpValue = 0; // don't double-push
      }
    };

    ["keydown", "click", "pointerdown", "touchstart"].forEach((evt) =>
      document.addEventListener(evt, finalizeLcp, { once: true, passive: true })
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) finalizeLcp();
    });
  } catch {
    /* not supported */
  }

  // ── 5. CLS — cumulative layout shift ────────────────────────────────────────
  try {
    let clsValue = 0;

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutEntry = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        };
        if (!layoutEntry.hadRecentInput && typeof layoutEntry.value === "number") {
          clsValue += layoutEntry.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && clsValue > 0) {
        const value = Math.round(clsValue * 1000) / 1000;
        pending.push({
          type: "vital",
          path,
          metric: "CLS",
          value,
          rating: getRating("CLS", value),
        });
      }
    });
  } catch {
    /* not supported */
  }

  // ── 6. INP — interaction to next paint (Chrome 96+) ─────────────────────────
  try {
    let maxInp = 0;

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = (entry as PerformanceEventTiming).duration;
        if (typeof duration === "number" && duration > maxInp) {
          maxInp = duration;
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && maxInp > 0) {
        pending.push({
          type: "vital",
          path,
          metric: "INP",
          value: Math.round(maxInp),
          rating: getRating("INP", maxInp),
        });
      }
    });
  } catch {
    /* not supported */
  }

  // ── 7. Session duration ping ─────────────────────────────────────────────────
  // Initialise the session start clock (no-op if already set for this session)
  getSessionStart();

  // Deduplicate: track last ping timestamp so visibilitychange + pagehide
  // firing together (which can happen) don't double-send within the same second.
  let lastPingTs = 0;

  function sendSessionPing(): void {
    const now = Date.now();
    if (now - lastPingTs < 1000) return;
    lastPingTs = now;
    sendEvents([{
      type: "session_ping",
      session_id: getSessionId(),
      visitor_id: getVisitorId(),
      duration_ms: now - getSessionStart(),
    }]);
  }

  // visibilitychange fires when the user switches tabs, minimises, or locks screen.
  // pagehide fires on actual navigation away / tab close — more reliable on mobile Safari.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      sendSessionPing();
      flush();
    }
  });

  window.addEventListener("pagehide", () => {
    sendSessionPing();
    flush();
  });

  // Fallback: flush after 12 seconds (catches metrics that fire early)
  setTimeout(flush, 12_000);
}
