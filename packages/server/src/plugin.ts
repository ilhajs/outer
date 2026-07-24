import type { AnyProcedure, Builder } from "@orpc/server";
import type { H3Event } from "h3";

import type { H3Middleware } from "./cors";
import type { SchemaResult } from "./schema";
import type { OuterResources } from "./types";

export type PluginContext = {
  /** The accumulated resources bag -- read from it, but prefer returning procedures over mutating it. */
  resources: Readonly<OuterResources>;
  /** The oRPC base builder with the current context type. */
  base: Builder<any, any>;
  /** The schema results accumulated so far. */
  schemas: readonly SchemaResult<any>[];
  /** The instance name. */
  name: string | undefined;
};

export type PluginResult = {
  /**
   * Procedures to register, keyed by dot-name (e.g. "webhook.receive").
   * They are added to the router the same way `.procedure()` adds them.
   */
  procedures?: Record<string, AnyProcedure>;
  /**
   * Raw H3 routes to mount, same as `.route()`.
   */
  routes?: Array<{
    method: string;
    path: string;
    handler: (event: H3Event, context: any) => unknown;
  }>;
  /**
   * Middleware to mount on the H3 server, same as the CORS/rate-limit middleware.
   * Runs in registration order, before routes.
   */
  middleware?: H3Middleware[];
};

export type OuterPlugin = {
  /** Unique name, used in error messages and to prevent double-registration. */
  name: string;
  /**
   * Called at `.use()` time (in the chain). Return nothing; store config internally.
   * Throw to fail fast on obviously invalid config.
   */
  configure?(): void;
  /**
   * Called at the start of `build()`, after all built-in validation.
   * Throw to reject the build. Pure validation, no side effects.
   */
  validate?(ctx: PluginContext): void;
  /**
   * Called during `build()` after built-in procedures (admin, files) are assembled.
   * Return procedures, routes, and/or middleware to add.
   */
  build?(ctx: PluginContext): PluginResult | void;
};
