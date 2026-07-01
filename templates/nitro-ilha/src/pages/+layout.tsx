import { Navbar } from "$lib/components/navbar";
import { client } from "$lib/outer";
import { defineLayout } from "@ilha/router";
import { Toaster } from "areia/sonner";
import ilha from "ilha";

export default defineLayout((Children) =>
  ilha
    .derived("session", () => client.auth.getSession())
    .render(({ derived }) => {
      if (derived.session.loading) return "";
      return (
        <div class="bg-areia-surface-elevated flex min-h-screen flex-col gap-4">
          <Navbar session={derived.session()?.data} />
          <main class="container mx-auto flex flex-1 flex-col p-2">
            {Children({ session: derived.session()?.data })}
          </main>
          <Toaster closeButton theme="system" />
        </div>
      );
    }),
);
