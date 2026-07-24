// The schema, secrets, and storage surfaces live in their own subpath entries:
// `@outerjs/server/schema`, `/secrets`, `/storage`.
export type { OuterKV } from "./kv";
export type { LiveProvider } from "./live";
export { liveIterable } from "./live";
export type { FilesConfig, FilesRouter, FilePermission, FileRecord } from "./files";
/** Throw from a handler to return a specific HTTP status instead of a 500. */
export { ORPCError } from "@orpc/client";
export { mcp } from "./types";
export type { ResourceOptions } from "./resource";
export type { DialectKind } from "./migrator";
export { compareVersions } from "./migrator";
export type {
  AdminConfig,
  AdminRouter,
  AdminMeta,
  AdminMigrationStatus,
  OuterAdminRouter,
} from "./admin";

export { Outer } from "./outer";
export { BuiltOuter } from "./built-outer";
export { memoryRateLimitStore } from "./rate-limit";
export type { OuterPlugin, PluginContext, PluginResult } from "./plugin";

export type {
  SessionUser,
  UserSession,
  OuterRpcContext,
  RateLimitStore,
  RateLimitConfig,
  InferRouter,
  ProcedurePermission,
  ProcedureOptions,
  AuthConfig,
  OuterParams,
  McpConfig,
  OpenApiConfig,
  CorsConfig,
  BaseErrorSource,
  ErrorSource,
  ErrorSourcesOf,
} from "./types";
