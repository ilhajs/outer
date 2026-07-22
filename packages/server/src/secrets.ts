/**
 * Minimal inline copy of the [Standard Schema](https://standardschema.dev) v1
 * interface, so `fromSchema` accepts Zod, Valibot, ArkType, etc. without Outer
 * taking a dependency on any of them (or on `@standard-schema/spec`). Only the
 * members we touch are typed.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}
export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }
  export type Result<Output> = SuccessResult<Output> | FailureResult;
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  export interface PathSegment {
    readonly key: PropertyKey;
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  /** The validated output type a schema produces — after defaults and transforms. */
  export type InferOutput<S extends StandardSchemaV1> = NonNullable<
    S["~standard"]["types"]
  >["output"];
}

type DefaultShape = Record<string, string | undefined>;

/**
 * A tiny, **synchronous**, runtime-agnostic accessor for configuration secrets
 * and bindings, surfaced as `context.secrets`. Core never touches `process.env`
 * directly, so the same `context.secrets.require("AUTH_SECRET")` call works on a
 * VPS (Node/Bun `process.env`), Cloudflare Workers (the per-request `env`
 * binding), or Deno — the environment difference lives in the adapter.
 *
 * The type parameter `T` is the parsed shape. With `fromSchema` it's inferred
 * from your Zod/Standard Schema (including defaults and transforms), so `get`,
 * `require`, and `all` are all typed per key. Without a schema it defaults to a
 * bag of `string | undefined`.
 *
 * Reads are sync on purpose: secrets come from an already-materialized source,
 * never a fetch. For an async backend (Vault, AWS Secrets Manager), resolve it
 * at startup and pass the resulting object to `fromRecord`/`fromSchema`.
 */
export type OuterSecrets<T extends object = DefaultShape> = {
  /** The value for `key`, typed as `T[key]`. */
  get<K extends keyof T & string>(key: K): T[K];
  /**
   * Like `get`, but throws a clear error when the value is missing/empty — the
   * deterministic replacement for `process.env.X!`, which silently yields
   * `undefined` at runtime on platforms without a `process` global.
   */
  require<K extends keyof T & string>(key: K): NonNullable<T[K]>;
  /**
   * The fully-parsed, typed object — the analog of `schema.parse(env)`. Read
   * bindings and transformed values straight off it (`secrets.all.CORS_ORIGINS`).
   */
  readonly all: T;
};

/** Builds an `OuterSecrets` whose reads come from `all`, sharing one `require` error. */
function makeSecrets<T extends object>(all: T): OuterSecrets<T> {
  return {
    all,
    get: (key) => all[key],
    require(key) {
      const value = all[key];
      if (value == null || value === "") {
        throw new Error(`Missing required secret "${String(key)}".`);
      }
      return value as NonNullable<T[typeof key]>;
    },
  };
}

/**
 * Reads from `process.env` — the Node and Bun default. Safe to call in
 * environments without a `process` global (every key reads `undefined` rather
 * than throwing), so importing it never breaks a Workers/Deno bundle.
 *
 * ```ts
 * new Outer({ db: pglite(), secrets: fromEnv() })
 * ```
 */
export function fromEnv(): OuterSecrets {
  const env = (globalThis as { process?: { env?: DefaultShape } }).process?.env;
  return makeSecrets<DefaultShape>(env ?? {});
}

/**
 * Reads from a plain record — the Cloudflare Workers `env` binding, a Deno
 * `Deno.env.toObject()`, or secrets you loaded from Vault/Secrets Manager at
 * startup. On Workers, construct Outer inside `fetch(req, env)` and pass the
 * binding:
 *
 * ```ts
 * export default {
 *   fetch(req: Request, env: Env) {
 *     const outer = new Outer({ db: d1(env.DB), secrets: fromRecord(env) })
 *       .auth({ secret: env.AUTH_SECRET })
 *       .build();
 *     return outer.handle(req);
 *   },
 * };
 * ```
 */
export function fromRecord<T extends object = DefaultShape>(record: T): OuterSecrets<T> {
  return makeSecrets(record);
}

/**
 * Validates `input` against a Standard Schema (Zod, Valibot, ArkType, …) and
 * returns a fully-typed accessor — the integrated replacement for a standalone
 * `schema.parse(env)`. Defaults and transforms in the schema flow through to
 * `get`/`require`/`all`, and bindings declared with `z.custom<T>()` stay typed:
 *
 * ```ts
 * const Env = z.object({
 *   AUTH_SECRET: z.string(),
 *   CORS_ORIGINS: z.string().transform((s) => s.split(",")),
 *   OUTER_FILES: z.custom<R2Bucket>(),
 * });
 * const secrets = fromSchema(Env, env);
 * secrets.all.CORS_ORIGINS; // string[]  — validated once, typed everywhere
 * secrets.require("AUTH_SECRET"); // string
 * ```
 *
 * Validation is synchronous: a schema whose `validate` returns a Promise (async
 * refinements) throws — resolve those at startup and pass the object to
 * `fromRecord`. Invalid input throws an error listing every failing path.
 */
export function fromSchema<S extends StandardSchemaV1>(
  schema: S,
  input: unknown,
): OuterSecrets<StandardSchemaV1.InferOutput<S> & object> {
  const result = schema["~standard"].validate(input);
  if (result instanceof Promise) {
    throw new Error(
      "`fromSchema` needs a synchronous schema, but validation returned a Promise (async refinements). Validate at startup and pass the resolved object to `fromRecord` instead.",
    );
  }
  if (result.issues) {
    const detail = result.issues
      .map((issue) => {
        const path = issue.path
          ?.map((segment) => (typeof segment === "object" ? segment.key : segment))
          .join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("; ");
    throw new Error(`Invalid environment: ${detail}`);
  }
  return makeSecrets(result.value as StandardSchemaV1.InferOutput<S> & object);
}

/** Non-persistent `OuterSecrets` backed by the given map — for tests and local experiments. */
export function memorySecrets<T extends object = Record<string, string>>(
  values: T = {} as T,
): OuterSecrets<T> {
  return makeSecrets(values);
}
