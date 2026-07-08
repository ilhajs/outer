import { client } from "$lib/outer";
import type { AuthSession } from "$lib/types";
import { navigate } from "@ilha/router";
import { LinkButton } from "areia";
import ilha from "ilha";

export const Navbar = ilha
  .input<{ authSession: AuthSession }>()
  .on("[data-action=logout]@click", async () => {
    await client.auth.signOut();
    return navigate("/login");
  })
  .render(({ derived, input }) => (
    <div class="border-areia-border bg-areia-background flex items-center justify-between border-b p-2">
      <LinkButton href="/" class="font-semibold">
        Outer
      </LinkButton>
      {input.authSession ? (
        <div class="flex items-center">
          <LinkButton>{input.authSession.user.email}</LinkButton>
          <LinkButton data-action="logout">Sign Out</LinkButton>
        </div>
      ) : (
        <LinkButton data-action="logout">Sign In</LinkButton>
      )}
    </div>
  ));
