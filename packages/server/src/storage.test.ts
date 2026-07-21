import { test, describe, expect } from "bun:test";

import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

import { fromUnstorage, fromS3, memoryStorage } from "./storage";

const bytes = new TextEncoder().encode("hello bytes");

describe("memoryStorage", () => {
  test("round-trips and deletes", async () => {
    const s = memoryStorage();
    expect(await s.get("missing")).toBeNull();
    await s.set("k", bytes);
    expect(new TextDecoder().decode((await s.get("k"))!)).toBe("hello bytes");
    await s.delete("k");
    expect(await s.get("k")).toBeNull();
  });
});

describe("fromUnstorage", () => {
  test("round-trips binary data through a real unstorage instance", async () => {
    const s = fromUnstorage(createStorage({ driver: memoryDriver() }));
    await s.set("a/b", bytes);
    const read = await s.get("a/b");
    expect(read).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(read!)).toBe("hello bytes");
    await s.delete("a/b");
    expect(await s.get("a/b")).toBeNull();
  });

  test("normalizes the shapes drivers hand back", async () => {
    const cases: Record<string, unknown> = {
      buffer: Buffer.from(bytes),
      arrayBuffer: bytes.buffer.slice(0),
      base64: Buffer.from(bytes).toString("base64"),
    };
    for (const [name, value] of Object.entries(cases)) {
      const s = fromUnstorage({
        getItemRaw: async () => value,
        setItemRaw: async () => {},
        removeItem: async () => {},
      });
      expect(new TextDecoder().decode((await s.get(name))!), name).toBe("hello bytes");
    }
  });

  test("throws on a non-binary value rather than corrupting it", async () => {
    const s = fromUnstorage({
      getItemRaw: async () => ({ not: "bytes" }),
      setItemRaw: async () => {},
      removeItem: async () => {},
    });
    await expect(s.get("x")).rejects.toThrow(/not binary data/);
  });
});

describe("fromS3", () => {
  const commands = {
    GetObjectCommand: class {
      constructor(public input: any) {}
    },
    PutObjectCommand: class {
      constructor(public input: any) {}
    },
    DeleteObjectCommand: class {
      constructor(public input: any) {}
    },
  };

  test("sends bucket-scoped commands and decodes the body", async () => {
    const sent: any[] = [];
    const client = {
      async send(command: any) {
        sent.push(command);
        if (command instanceof commands.GetObjectCommand) {
          return { Body: { transformToByteArray: async () => bytes } };
        }
        return {};
      },
    };
    const s = fromS3(client, commands as any, "my-bucket");

    await s.set("k", bytes);
    expect(sent[0].input).toMatchObject({ Bucket: "my-bucket", Key: "k" });
    expect(new TextDecoder().decode((await s.get("k"))!)).toBe("hello bytes");
    await s.delete("k");
    expect(sent[2].input).toMatchObject({ Bucket: "my-bucket", Key: "k" });
  });

  test("a missing object is null, not a throw", async () => {
    const client = {
      async send() {
        throw Object.assign(new Error("nope"), { name: "NoSuchKey" });
      },
    };
    expect(await fromS3(client, commands as any, "b").get("gone")).toBeNull();
  });

  test("other S3 errors propagate", async () => {
    const client = {
      async send() {
        throw Object.assign(new Error("denied"), { name: "AccessDenied" });
      },
    };
    await expect(fromS3(client, commands as any, "b").get("k")).rejects.toThrow("denied");
  });
});
