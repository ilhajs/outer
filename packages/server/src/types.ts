import type { AnyProcedure } from "@orpc/server";
import type { BetterAuthOptions, Auth } from "better-auth";
import type { H3Event, HTTPMethod } from "h3";
import type { Dialect, Kysely } from "kysely";

import type { AdminConfig } from "./admin";
import type { FilesConfig } from "./files";
import type { OuterKV } from "./kv";
import type { LiveProvider } from "./live";
import type { DialectKind } from "./migrator";
import type { OuterSecrets } from "./secrets";
import type { Sola } from "./sola";
import type { OuterStorage } from "./storage";

export type OuterAuth = Auth<any>;

export type OuterDB<TDB> = Kysely<TDB> & {
  query: Sola<TDB>;
  /**
   * Runs `fn` inside a database transaction. The `trx` passed to `fn` is a
   * full `context.db` (Kysely + `query`), so Sola reads and Kysely writes both
   * participate in the transaction. Rolls back if `fn` throws.
   */
  transact<R>(fn: (trx: OuterDB<TDB>) => Promise<R>): Promise<R>;
};

/** The signed-in user, as Better Auth returns it (plus whatever plugins add). */
export type SessionUser = { id: string; email: string; role?: string } & Record<string, unknown>;
export type UserSession = { id: string; userId: string; expiresAt: Date } & Record<string, unknown>;

export type OuterRpcContext<TDB = any> = {
  headers: Headers;
  db: OuterDB<TDB>;
  auth?: OuterAuth;
  /**
   * Resolved once per request when `.auth()` is enabled, `null` when there's no
   * session (and always `null` without `.auth()`). Widened to non-null-typed
   * access after `.auth()` — see `AuthedContext`.
   */
  user?: SessionUser | null;
  session?: UserSession | null;
  /** The object store passed as `new Outer({ storage })`, if any. */
  storage?: OuterStorage;
  /** The secret accessor passed as `new Outer({ secrets })`, if any. */
  secrets?: OuterSecrets;
  /** The key/value store passed as `new Outer({ kv })`, if any. */
  kv?: OuterKV;
};

/** Context additions `.auth()` guarantees: `auth` is present and `user`/`session` are always resolved (possibly to `null`). */
export type AuthedContext = {
  auth: OuterAuth;
  user: SessionUser | null;
  session: UserSession | null;
};

/** Per-key request counter backing `rateLimit`. Swap in Redis/Upstash for multi-instance deploys. */
export type RateLimitStore = {
  /** Records a hit and returns the running count plus when the window resets (epoch ms). */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  /** Releases any timers/handles. Called by `BuiltOuter.close()`. */
  dispose?(): void;
};

export type RateLimitConfig = {
  /** Requests allowed per window, per key. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Identifies the caller. Defaults to the signed-in user id, falling back to
   * the client IP from `x-forwarded-for` / `x-real-ip`.
   *
   * **The header fallback is only trustworthy behind a proxy you control.**
   * `x-forwarded-for` / `x-real-ip` are plain request headers: if requests can
   * reach the server directly, an anonymous caller spoofs a fresh value per
   * request and never hits the limit. And behind a proxy that *strips* them,
   * every anonymous caller collapses into one shared `"unknown"` bucket, so one
   * abuser locks everyone out. Set this explicitly to key off whatever your host
   * actually forwards (a verified client IP, an API-key id, etc.).
   */
  key?: (event: H3Event, user: SessionUser | null) => string | Promise<string>;
  /** Return true to bypass the limit for a request. */
  skip?: (event: H3Event) => boolean | Promise<boolean>;
  /** Defaults to an in-process store — per-instance, so it does not coordinate across replicas. */
  store?: RateLimitStore;
};

/** Extracts the oRPC router type from an `Outer` or `BuiltOuter` instance. */
export type InferRouter<T> = T extends { router: infer R } ? R : never;

/** Turns dot-notation `"user.me"` into the nested router shape `{ user: { me: TProc } }`. */
export type NestRoute<TPath extends string, TProc> = TPath extends `${infer Head}.${infer Rest}`
  ? { [K in Head]: NestRoute<Rest, TProc> }
  : { [K in TPath]: TProc };

/** Deep-merges two router shapes, matching the runtime `deepMerge` behavior. */
export type MergeRouters<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? A[K] extends AnyProcedure
        ? B[K]
        : B[K] extends AnyProcedure
          ? B[K]
          : MergeRouters<A[K], B[K]>
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

/**
 * Declarative access control for `.procedure()`, using the same vocabulary as
 * `.resource()`. `"owner"` is deliberately absent — there's no row to own.
 */
export type ProcedurePermission<TContext> =
  | "public"
  | "authenticated"
  | "admin"
  | ((args: { context: TContext }) => boolean | Promise<boolean>);

export type ProcedureOptions<TContext> = {
  /** Defaults to `"public"` — no check, matching procedures without options. */
  permission?: ProcedurePermission<TContext>;
  /** Roles accepted by `"admin"`. Defaults to `["admin"]`. */
  roles?: string[];
};

/** Extracts the `ownerColumn` literal from resource options so create inputs can omit it (it's auto-filled from the session). */
export type OwnerColumnOf<TOptions> = TOptions extends { ownerColumn: infer O extends string }
  ? O
  : never;

export type AuthConfig = Omit<BetterAuthOptions, "database"> & {
  /** Secret used by Better Auth to sign/encrypt sessions, cookies, and tokens. */
  secret: string;
  /**
   * Defaults to the `baseUrl` passed to `new Outer({ baseUrl })` — set this to override it just for auth.
   * Accepts Better Auth's `DynamicBaseURLConfig` (`{ allowedHosts, fallback?, protocol? }`) for deployments
   * behind a dynamic/preview domain (Vercel previews, StackBlitz, etc.) where the origin isn't known upfront.
   */
  baseURL?: BetterAuthOptions["baseURL"];
};

/** Sources that always reach `onError` — RPC failures and raw route/health probes. */
export type BaseErrorSource = "rpc" | "route";

/** Every source `onError` may observe once optional features are enabled. */
export type ErrorSource = BaseErrorSource | "rest" | "mcp";

/**
 * Error sources that can fire for a given feature set. `rest` only appears when
 * `.openapi()` is enabled; `mcp` only when `.mcp()` is enabled.
 */
export type ErrorSourcesOf<TOpenApi extends boolean = false, TMcp extends boolean = false> =
  | BaseErrorSource
  | (TOpenApi extends true ? "rest" : never)
  | (TMcp extends true ? "mcp" : never);

export type OuterParams<TSource extends ErrorSource = ErrorSource> = {
  name?: string;
  /**
   * Public origin of this server (no trailing slash), used by Better Auth and
   * the OpenAPI `servers` entry. When omitted outside production, defaults to
   * `http://localhost:${PORT || 3000}` so local auth works without boilerplate.
   * In production you must set it explicitly (or via `.auth({ baseURL })`).
   */
  baseUrl?: string;
  /**
   * A Kysely `Dialect` plus the dialect family it belongs to — `kind` drives
   * DDL generation, Better Auth's schema, and DB error mapping, so it must
   * match the dialect you provide. For the zero-infra embedded Postgres
   * default, use `pglite()` from `@outerjs/server/pglite`:
   * `new Outer({ db: pglite() })`. For anything else (network Postgres,
   * Cloudflare D1/Durable Objects, etc.) construct the `Dialect` yourself.
   */
  db: { dialect: Dialect; kind: DialectKind; live?: LiveProvider };
  /**
   * Cross-origin browser callers allowed to reach `/rpc/**`, `/api/auth/**`,
   * and the admin API. Lives on the constructor (not a chain method) so it's
   * the single source of truth: `.auth()` always folds these origins into
   * Better Auth's `trustedOrigins` regardless of call order. Without it, no
   * `Access-Control-Allow-Origin` header is set — same-origin requests and
   * non-browser clients are unaffected.
   */
  cors?: CorsConfig;
  /**
   * Object store for file bytes, surfaced as `context.storage` and used by
   * `.files()`. Wrap unstorage/Nitro's `useStorage()` with `fromUnstorage()`,
   * an S3 client with `fromS3()`, or pass any `OuterStorage` implementation.
   */
  storage?: OuterStorage;
  /**
   * Runtime-agnostic secret accessor, surfaced as `context.secrets`. Wrap
   * `process.env` with `fromEnv()`, the Cloudflare Workers `env` binding with
   * `fromRecord(env)`, or pass any `OuterSecrets` implementation — so the same
   * `context.secrets.require("STRIPE_KEY")` resolves identically everywhere.
   * `fromSchema(zodSchema, env)` gives a fully-typed accessor; any parsed shape
   * is accepted here.
   */
  secrets?: OuterSecrets<any>;
  /**
   * Key/value store, surfaced as `context.kv`. Pass any
   * [unstorage](https://unstorage.unjs.io) instance — Nitro's `useStorage()`,
   * a bare `createStorage({ driver })`, or a Cloudflare KV / Vercel Runtime Cache driver —
   * so the same `context.kv.getItem(...)` resolves against whatever backend the
   * host provides, with TTL via `setItem(key, value, { ttl })`.
   */
  kv?: OuterKV;
  /**
   * Called for unexpected failures — anything that isn't a deliberate
   * `ORPCError` response. Route it to your logger or Sentry; without it,
   * Outer writes to `console.error`. Pass `() => {}` to silence it.
   *
   * `source` is typed by `TSource` (defaults to the full {@link ErrorSource}
   * union). Prefer {@link ErrorSourcesOf} once you know which features you
   * enable: `rest` only fires with `.openapi()`, `mcp` only with `.mcp()`.
   */
  onError?: (error: unknown, info: { request: Request; source: TSource }) => void;
  /**
   * Mounts `GET /health`, returning `{ status, database }` with a `select 1`
   * probe — for Coolify/Docker/uptime checks. Enabled by default; pass `false`
   * to omit it, or a `path` to move it. A `.route()` on the same path wins.
   */
  health?: boolean | { path?: string };
  /**
   * Per-caller request limit for `/rpc/**` and `/rest/**`. Off by default.
   * `/api/auth/**` is excluded — Better Auth ships its own limiter.
   */
  rateLimit?: RateLimitConfig;
};

export type OuterRoute<TContext> = {
  method: HTTPMethod | Lowercase<HTTPMethod> | "";
  path: string;
  handler: (event: H3Event, context: TContext) => unknown;
};

export type OuterResources = {
  dialect: Dialect;
  dialectKind: DialectKind;
  /** Backs `context.db.query.<table>.live()`; absent for dialects that can't stream changes. */
  live: LiveProvider | undefined;
  db: Kysely<any>;
  baseUrl: string | undefined;
  auth: OuterAuth | undefined;
  onError: ((error: unknown, info: { request: Request; source: ErrorSource }) => void) | undefined;
  health: OuterParams["health"];
  rateLimit: RateLimitConfig | undefined;
  openapiEnabled: boolean;
  /** Set by `.mcp()`; the MCP endpoint is mounted at `.build()`. */
  mcp: McpConfig | undefined;
  routes: OuterRoute<any>[];
  /** `"resource.action"` entries whose permission requires a session — checked against `auth` at `.build()`. */
  authRequiredBy: string[];
  cors: CorsConfig | undefined;
  /** Set by `.admin()` — the `_admin.*` procedures are built at `.build()` so they see the final schema and migrator. */
  admin: AdminConfig | undefined;
  /** Set by `.files()` — the `file.*` procedures are built at `.build()` so they see the final schema. */
  files: FilesConfig | undefined;
  storage: OuterStorage | undefined;
  secrets: OuterSecrets<any> | undefined;
  kv: OuterKV | undefined;
};

export type McpConfig = {
  /** Mounts the MCP endpoint. Defaults to `true` when `.mcp()` is called. */
  enabled?: boolean;
  /** Where to serve it. Defaults to `/mcp`. */
  path?: string;
  /** Server identity reported to clients during `initialize`. Defaults to the Outer instance name. */
  serverInfo?: { name?: string; version?: string };
  /** Free-form guidance returned to the client during `initialize`. */
  instructions?: string;
  /** Reject browser `Origin`/`Host` values outside the allowlists (DNS-rebinding protection). */
  enableDnsRebindingProtection?: boolean;
  allowedOrigins?: string[];
  allowedHosts?: string[];
};

export type OpenApiConfig = {
  /** Whether to mount `GET /openapi.json`. Defaults to `true` when `.openapi()` is called — pass `import.meta.env.DEV` or similar to gate it on dev/staging only. */
  enabled?: boolean;
};

export type CorsConfig = {
  /**
   * Allowed origins. Also merged into Better Auth's `trustedOrigins` when
   * `.auth()` is used.
   *
   * `["*"]` allows every origin — intended for public, unauthenticated APIs.
   * Combining it with `credentials: true` lets any site make authenticated
   * requests using a visitor's cookies, so list origins explicitly instead
   * whenever the API is behind a session.
   */
  origins: string[];
  credentials?: boolean;
};

/**
 * Marks a procedure for MCP exposure — `mcp.tool()`, `mcp.resource()`,
 * `mcp.prompt()`. Mirrors `orpc-mcp`'s `mcp` helper (a pure `~mcp` meta-plugin
 * factory) so importing `@outerjs/server` never pulls in the optional peer —
 * bundlers targeting Cloudflare Workers would fail to resolve it otherwise.
 */
export const mcp: typeof import("orpc-mcp").mcp = {
  tool: (meta = {}) => createMcpMetaPlugin({ ...meta, type: "tool" }),
  resource: (meta) => createMcpMetaPlugin({ ...meta, type: "resource" }),
  prompt: (meta = {}) => createMcpMetaPlugin({ ...meta, type: "prompt" }),
};

function createMcpMetaPlugin(incoming: any): any {
  return {
    name: "~mcp",
    init(meta: any) {
      const existing = meta["~mcp"];
      const annotations =
        existing?.annotations && incoming.annotations
          ? { ...existing.annotations, ...incoming.annotations }
          : "annotations" in incoming
            ? incoming.annotations
            : existing?.annotations;
      return {
        ...meta,
        "~mcp": {
          ...existing,
          ...incoming,
          ...(annotations !== undefined ? { annotations } : {}),
        },
      };
    },
  };
}
