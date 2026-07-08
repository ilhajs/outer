import { Navbar } from "$lib/components/navbar";
import { client } from "$lib/outer";
import { defineLayout, type InferLoader, loader } from "@ilha/router";
import { Toaster } from "areia/sonner";
import ilha from "ilha";

export const clientLoad = loader(async ({ signal }) => {
  const authSession = await client.auth.getSession({
    fetchOptions: { signal },
  });
  return { authSession: authSession.data };
});

export default defineLayout((Children) =>
  ilha.input<InferLoader<typeof clientLoad>>().render(({ input }) => (
    <div class="bg-areia-surface-elevated flex min-h-screen flex-col gap-4">
      <Navbar authSession={input.authSession} />
      <main class="container mx-auto flex flex-1 flex-col p-2">
        <Children authSession={input.authSession} />
      </main>
      <Toaster closeButton theme="system" />
    </div>
  )),
);
