/**
 * The three operations Outer needs from an object store. Deliberately tiny and
 * runtime-agnostic: core never depends on unstorage, S3, or a filesystem, so the
 * same `.files()` procedures work on a VPS, Cloudflare R2, or an S3 bucket.
 */
export type OuterStorage = {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
};

/** The slice of unstorage's `Storage` we use — structural, so no unstorage import is needed. */
type UnstorageLike = {
  getItemRaw(key: string): Promise<unknown>;
  setItemRaw(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * Adapts an [unstorage](https://unstorage.unjs.io) instance — including Nitro's
 * `useStorage()` — to `OuterStorage`. The driver (fs-lite, s3, cloudflare-r2, …)
 * is chosen in your unstorage/Nitro config, so moving to object storage in
 * production needs no change here.
 *
 * ```ts
 * new Outer({ db: pglite(), storage: fromUnstorage(useStorage("fs")) })
 * ```
 */
export function fromUnstorage(storage: UnstorageLike): OuterStorage {
  return {
    async get(key) {
      const value = await storage.getItemRaw(key);
      return value == null ? null : toBytes(value);
    },
    // setItemRaw keeps the bytes as bytes; setItem would JSON-serialize them
    set: (key, bytes) => storage.setItemRaw(key, bytes),
    delete: (key) => storage.removeItem(key),
  };
}

/**
 * Adapts anything with the S3 `GetObject`/`PutObject`/`DeleteObject` shape —
 * `@aws-sdk/client-s3`, or an R2 bucket binding.
 */
export function fromS3(
  client: {
    send(command: unknown): Promise<any>;
  },
  commands: {
    GetObjectCommand: new (input: any) => unknown;
    PutObjectCommand: new (input: any) => unknown;
    DeleteObjectCommand: new (input: any) => unknown;
  },
  bucket: string,
): OuterStorage {
  const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = commands;
  return {
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await out?.Body?.transformToByteArray?.();
        return bytes ? toBytes(bytes) : null;
      } catch (error) {
        // A missing object is a `null`, not a failure — anything else is real
        if ((error as { name?: string })?.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async set(key, bytes) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** Non-persistent `OuterStorage` backed by a `Map` — for tests and local experiments. */
export function memoryStorage(): OuterStorage {
  const store = new Map<string, Uint8Array>();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, bytes) => void store.set(key, bytes),
    delete: async (key) => void store.delete(key),
  };
}

/** Drivers hand back Buffers, ArrayBuffers, or base64 strings depending on the backend. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  throw new Error(`Storage returned a value that is not binary data: ${typeof value}`);
}
