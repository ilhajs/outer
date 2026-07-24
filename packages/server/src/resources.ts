import type { OuterResources } from "./types";

/**
 * Deep-enough clone of the resources bag for Outer chain clones.
 * Mutable arrays and nested config objects are copied so later mutations on one
 * instance never bleed into another. Shared handles (db, dialect, storage, …)
 * stay shared by reference — those are intentionally single-owner.
 */
export function cloneResources(resources: OuterResources): OuterResources {
  return {
    ...resources,
    routes: resources.routes.map((r) => ({ ...r })),
    authRequiredBy: [...resources.authRequiredBy],
    ...(resources.cors && {
      cors: { ...resources.cors, origins: [...resources.cors.origins] },
    }),
    ...(resources.mcp && {
      mcp: {
        ...resources.mcp,
        ...(resources.mcp.serverInfo && { serverInfo: { ...resources.mcp.serverInfo } }),
        ...(resources.mcp.allowedOrigins && {
          allowedOrigins: [...resources.mcp.allowedOrigins],
        }),
        ...(resources.mcp.allowedHosts && { allowedHosts: [...resources.mcp.allowedHosts] }),
      },
    }),
    ...(resources.admin && {
      admin: {
        ...resources.admin,
        ...(resources.admin.listLimit && { listLimit: { ...resources.admin.listLimit } }),
        ...(resources.admin.roles && { roles: [...resources.admin.roles] }),
      },
    }),
    ...(resources.files && {
      files: {
        ...resources.files,
        ...(resources.files.accept && { accept: [...resources.files.accept] }),
        ...(resources.files.permissions && {
          permissions: { ...resources.files.permissions },
        }),
        ...(resources.files.roles && { roles: [...resources.files.roles] }),
      },
    }),
    ...(resources.rateLimit && { rateLimit: { ...resources.rateLimit } }),
    ...(typeof resources.health === "object" &&
      resources.health && { health: { ...resources.health } }),
  };
}

/**
 * Snapshot for plugin context — a frozen shallow copy so plugins cannot mutate
 * the live resources bag through the read-only view.
 */
export function freezeResourcesSnapshot(resources: OuterResources): Readonly<OuterResources> {
  return Object.freeze(cloneResources(resources));
}
