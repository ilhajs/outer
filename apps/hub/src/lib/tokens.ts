import { persist, store } from "@ilha/store";
import { z } from "zod";

/**
 * Local registry of API tokens, one list per instance. These are generated and
 * kept client-side for now — a placeholder until the server exposes real token
 * management for MCP. Persisted to localStorage so they survive reloads.
 */
const TokenSchema = z.object({
  id: z.string(),
  instanceId: z.string(),
  name: z.string(),
  token: z.string(),
  createdAt: z.string(),
});

export type ApiToken = z.infer<typeof TokenSchema>;

export const tokensStore = store(
  z.object({
    tokens: z.array(TokenSchema).default([]),
  }),
)
  .action("add", (token: ApiToken, { get }) => ({ tokens: [...get().tokens, token] }))
  .action("remove", (id: string, { get }) => ({
    tokens: get().tokens.filter((token) => token.id !== id),
  }))
  .build();

persist(tokensStore, "outerTokens");

/** All tokens registered for a given instance, newest first. */
export function tokensForInstance(instanceId: string): ApiToken[] {
  return tokensStore
    .tokens()
    .filter((token) => token.instanceId === instanceId)
    .slice()
    .reverse();
}

/** `outer_` + 32 bytes of URL-safe base64 randomness. */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `outer_${base64}`;
}
