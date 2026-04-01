import { BatchQueue, LogQueue } from "./core";
import type { StatvisorOptions, SdkEvent, LogLevel } from "./types";

export type { StatvisorOptions, SdkEvent, IngestPayload, LogLevel, LogEvent, LogPayload } from "./types";
export { BatchQueue, LogQueue } from "./core";

// ---------------------------------------------------------------------------
// Module-level default queue instance (created lazily)
// ---------------------------------------------------------------------------

let _defaultQueue: BatchQueue | null = null;
let _defaultQueueKey: string | null = null;
let _logQueue: LogQueue | null = null;

function getOrCreateQueue(options: StatvisorOptions): BatchQueue {
  if (!_defaultQueue) {
    _defaultQueue = new BatchQueue(options);
    _logQueue = new LogQueue(options);
    _defaultQueueKey = options.apiKey;

    if (typeof process !== "undefined" && typeof process.on === "function") {
      process.on("beforeExit", () => {
        _defaultQueue?.flush().catch(() => undefined);
        _logQueue?.flush().catch(() => undefined);
      });

      process.on("SIGTERM", () => {
        Promise.all([
          _defaultQueue?.shutdown() ?? Promise.resolve(),
          _logQueue?.shutdown() ?? Promise.resolve(),
        ]).finally(() => process.exit(0));
      });
    }
  } else if (options.debug && options.apiKey !== _defaultQueueKey) {
    console.warn(
      "[statvisor] Statvisor was already initialised with a different API key — " +
        "the existing queue will be reused. Call shutdown() first to reinitialise."
    );
  }
  return _defaultQueue;
}

/** Flush all pending events immediately. Call before process exit if needed. */
export async function shutdown(): Promise<void> {
  await Promise.all([
    _defaultQueue?.shutdown() ?? Promise.resolve(),
    _logQueue?.shutdown() ?? Promise.resolve(),
  ]);
  _defaultQueue = null;
  _defaultQueueKey = null;
  _logQueue = null;
}

/**
 * Emit a structured log event. Requires the SDK to be initialised first
 * (e.g. via `express()`, `fastify()`, or `nextjs()`).
 *
 * @example
 * import * as statvisor from '@statvisor/sdk';
 * statvisor.log("error", "Payment failed", { userId, amount });
 * statvisor.log("warn", "Retry triggered", { attempt: 3 });
 * statvisor.log("info", "User signed up", { plan: "pro" });
 */
export function log(level: LogLevel, message: string, data?: unknown): void {
  if (!_logQueue) {
    // SDK not initialised — silently drop
    return;
  }
  _logQueue.push({ level, message, data, timestamp: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

type ExpressRequest = {
  method: string;
  path: string;
  route?: { path?: string };
};

type ExpressResponse = {
  statusCode: number;
  locals: Record<string, unknown>;
  on(event: string, listener: () => void): void;
};

type NextFunction = () => void;

export type ExpressRequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
) => void;

/**
 * Express middleware that tracks request latency and status codes.
 *
 * @example
 * import * as statvisor from '@statvisor/sdk';
 * app.use(statvisor.express({ apiKey: 'vl_...' }));
 */
export function express(options: StatvisorOptions): ExpressRequestHandler {
  const queue = getOrCreateQueue(options);

  return function statvisorMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
  ) {
    const startTime = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      const route = req.route?.path ?? req.path ?? "unknown";
      const error =
        typeof res.locals.error === "string" ? res.locals.error : undefined;

      const event: SdkEvent = {
        route,
        method: req.method,
        status_code: res.statusCode,
        duration_ms: durationMs,
        ...(error ? { error } : {}),
        timestamp: new Date().toISOString(),
      };

      queue.push(event);
    });

    next();
  };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

type FastifyInstance = {
  addHook(
    name: "onResponse",
    fn: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  ): void;
};

type FastifyRequest = {
  method: string;
  routerPath?: string;
  routeOptions?: { url?: string };
};

type FastifyReply = {
  statusCode: number;
  elapsedTime?: number;
};

type FastifyPlugin = (
  fastify: FastifyInstance,
  _opts: Record<string, unknown>,
  done: () => void
) => void;

/**
 * Fastify plugin that tracks request latency and status codes.
 *
 * @example
 * import * as statvisor from '@statvisor/sdk';
 * await fastify.register(statvisor.fastify, { apiKey: 'vl_...' });
 */
export function fastify(options: StatvisorOptions): FastifyPlugin {
  const queue = getOrCreateQueue(options);

  return function statvisorFastifyPlugin(
    fastifyInstance: FastifyInstance,
    _opts: Record<string, unknown>,
    done: () => void
  ) {
    fastifyInstance.addHook(
      "onResponse",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const route =
          request.routerPath ??
          request.routeOptions?.url ??
          "unknown";

        const durationMs =
          typeof reply.elapsedTime === "number"
            ? Math.round(reply.elapsedTime)
            : 0;

        const event: SdkEvent = {
          route,
          method: request.method,
          status_code: reply.statusCode,
          duration_ms: durationMs,
          timestamp: new Date().toISOString(),
        };

        queue.push(event);
      }
    );

    done();
  };
}

// ---------------------------------------------------------------------------
// Generic / Hono / Edge middleware
// ---------------------------------------------------------------------------

type GenericHandler = (
  request: Request,
  env?: unknown
) => Promise<Response>;

/**
 * Generic fetch-based middleware wrapper for Hono, Cloudflare Workers,
 * and other edge runtimes.
 *
 * Returns a handler that you can use as a Hono middleware or wrap your
 * existing fetch handler with.
 *
 * @example
 * // Hono
 * import { Hono } from 'hono';
 * import { createMiddleware } from '@statvisor/sdk';
 *
 * const app = new Hono();
 * app.use('*', createMiddleware({ apiKey: 'vl_...' }));
 */
export function createMiddleware(options: StatvisorOptions) {
  const queue = getOrCreateQueue(options);

  return async function statvisorHonoMiddleware(
    c: {
      req: { method: string; url: string; routePath?: string };
      res?: { status?: number };
    },
    next: () => Promise<void>
  ) {
    const startTime = Date.now();

    try {
      await next();
    } finally {
      const durationMs = Date.now() - startTime;

      let route: string;
      try {
        route = c.req.routePath ?? new URL(c.req.url).pathname ?? "unknown";
      } catch {
        route = "unknown";
      }

      const statusCode = c.res?.status ?? 200;

      const event: SdkEvent = {
        route,
        method: c.req.method,
        status_code: statusCode,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };

      queue.push(event);
    }
  };
}

/**
 * Wrap a generic fetch handler (for edge runtimes like Cloudflare Workers).
 *
 * @example
 * import { wrapFetch } from '@statvisor/sdk';
 *
 * export default {
 *   fetch: wrapFetch({ apiKey: 'vl_...' }, async (request, env) => {
 *     return new Response('Hello!');
 *   })
 * };
 */
export function wrapFetch(
  options: StatvisorOptions,
  handler: GenericHandler
): GenericHandler {
  const queue = getOrCreateQueue(options);

  return async function wrappedFetch(request: Request, env?: unknown) {
    const startTime = Date.now();
    let statusCode = 200;

    try {
      const response = await handler(request, env);
      statusCode = response.status;
      return response;
    } catch (err) {
      statusCode = 500;
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;

      let route: string;
      try {
        route = new URL(request.url).pathname ?? "unknown";
      } catch {
        route = "unknown";
      }

      const event: SdkEvent = {
        route,
        method: request.method,
        status_code: statusCode,
        duration_ms: durationMs,
        timestamp: new Date().toISOString(),
      };

      queue.push(event);
    }
  };
}

// ---------------------------------------------------------------------------
// Next.js App Router
// ---------------------------------------------------------------------------

type NextJsRequest = Request & {
  nextUrl?: { pathname: string };
  cookies?: unknown;
  geo?: unknown;
  ip?: string;
};

type NextJsResponse = Response;

/** Params shape for Next.js 14 (plain object) and Next.js 15+ (Promise). */
export type NextJsParams<P extends Record<string, string> = Record<string, string>> =
  | P
  | Promise<P>;

/** Context object passed as the second argument to Next.js App Router handlers. */
export type NextJsContext<P extends Record<string, string> = Record<string, string>> = {
  params: NextJsParams<P>;
};

type NextJsHandler<C = NextJsContext> = {
  bivarianceHack(req: NextJsRequest, context?: C): Promise<NextJsResponse> | NextJsResponse;
}["bivarianceHack"];

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
type RouteHandlers = Partial<Record<HttpMethod, NextJsHandler>>;

/**
 * Next.js App Router integration.
 *
 * Returns two helpers:
 * - `route(path, { GET, POST, ... })` — wraps all handlers in a file at once (recommended)
 * - `monitor(path, handler)` — wraps a single handler
 *
 * @example
 * // lib/statvisor.ts
 * import * as statvisor from '@statvisor/sdk';
 * export const { route } = statvisor.nextjs({ apiKey: process.env.STATVISOR_API_KEY! });
 *
 * // app/api/users/route.ts
 * import { NextResponse } from 'next/server';
 * import { route } from '@/lib/statvisor';
 *
 * export const { GET, POST } = route('/api/users', {
 *   GET: async (req) => NextResponse.json({ users: [] }),
 *   POST: async (req) => NextResponse.json({}, { status: 201 }),
 * });
 */
export function nextjs(options: StatvisorOptions) {
  const queue = getOrCreateQueue(options);

  function wrap<C>(
    routePath: string | undefined,
    handler: NextJsHandler<C>
  ): NextJsHandler<C> {
    return async (req: NextJsRequest, context?: C) => {
      const start = Date.now();
      let statusCode = 200;

      try {
        const response = await handler(req, context);
        statusCode = response.status;
        return response;
      } catch (err) {
        statusCode = 500;
        throw err;
      } finally {
        let resolvedRoute: string;
        if (routePath) {
          resolvedRoute = routePath;
        } else {
          try {
            resolvedRoute = req.nextUrl?.pathname ?? new URL(req.url).pathname;
          } catch {
            resolvedRoute = "unknown";
          }
        }

        queue.push({
          route: resolvedRoute,
          method: req.method,
          status_code: statusCode,
          duration_ms: Date.now() - start,
          timestamp: new Date().toISOString(),
        });

        // Await the flush so the event is guaranteed to be delivered before
        // the function returns — works on Node.js, serverless, and edge runtimes.
        await queue.flush().catch(() => undefined);
      }
    };
  }

  /** Wrap all handlers in a route file at once. One call per file. */
  function route<H extends RouteHandlers>(routePath: string, handlers: H): H {
    return Object.fromEntries(
      Object.entries(handlers).map(([method, handler]) => [
        method,
        wrap(routePath, handler as NextJsHandler),
      ])
    ) as H;
  }

  /** Wrap a single handler. */
  function monitor<C>(routePath: string, handler: NextJsHandler<C>): NextJsHandler<C>;
  function monitor<C>(handler: NextJsHandler<C>): NextJsHandler<C>;
  function monitor<C>(
    routeOrHandler: string | NextJsHandler<C>,
    maybeHandler?: NextJsHandler<C>
  ): NextJsHandler<C> {
    const routePath = typeof routeOrHandler === "string" ? routeOrHandler : undefined;
    const handler = typeof routeOrHandler === "function" ? routeOrHandler : maybeHandler!;
    return wrap(routePath, handler);
  }

  return { route, monitor };
}
