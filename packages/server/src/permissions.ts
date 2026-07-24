import { ORPCError } from "@orpc/client";

import { hasRole } from "./resource";
import type { OuterAuth, ProcedurePermission } from "./types";

/**
 * oRPC middleware enforcing a procedure permission. Reads the `user` that
 * `.auth()` already resolved for this request rather than re-querying it.
 */
export function procedurePermission(
  permission: Exclude<ProcedurePermission<any>, "public">,
  resources: { auth: OuterAuth | undefined },
  roles: string[] = ["admin"],
) {
  return async ({ context, next }: any) => {
    if (typeof permission === "function") {
      if (!(await permission({ context }))) {
        throw new ORPCError("FORBIDDEN", { message: "Permission denied" });
      }
      return next();
    }
    if (!resources.auth) {
      throw new Error(
        "This procedure permission requires auth — call `.auth()` on the Outer instance before `.build()`",
      );
    }
    if (!context.user) throw new ORPCError("UNAUTHORIZED", { message: "You must be signed in" });
    if (permission === "admin" && !hasRole(context.user, roles)) {
      throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
    }
    return next();
  };
}
