// Public entry for `@outerjs/server/schema` — the schema DSL and its types.
// Also re-exported from the package root for backward compatibility.
export { schema, timestamps, parseSet, toSet } from "../schema";
export type {
  SchemaResult,
  InferDB,
  TablesDef,
  ColumnDef,
  ApiKeyTable,
  AuthOptions,
  AuthTables,
  FileTables,
  FilesOptions,
} from "../schema";
