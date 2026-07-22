// Public entry for `@outerjs/server/secrets` — secret accessors and their types.
// Also re-exported from the package root for backward compatibility.
export { fromEnv, fromRecord, fromSchema, memorySecrets } from "../secrets";
export type { OuterSecrets, StandardSchemaV1 } from "../secrets";
