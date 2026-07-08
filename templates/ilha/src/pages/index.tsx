import type { AuthSession } from "$lib/types";
import { head, navigate } from "@ilha/router";
import { LayerCard, Link } from "areia";
import ilha from "ilha";

const codeClass = "bg-areia-background rounded-lg p-3 text-sm overflow-x-auto";

export default ilha
  .input<{ authSession: AuthSession }>()
  .onMount(({ input }) => {
    if (input.authSession) return;
    navigate("/login");
  })
  .render(() => {
    head({ title: "Home" });
    return (
      <div class="flex flex-col gap-4">
        <LayerCard>
          <LayerCard.Title>Get Started</LayerCard.Title>
          <LayerCard.Content class="flex flex-col gap-4">
            <ol class="flex list-decimal flex-col gap-4 pl-5">
              <li>
                <p class="font-medium">Add a table to your schema</p>
                <p class="text-sm">
                  Edit <code>src/lib/schemas/v1-0-0.ts</code> and add a <code>.table(...)</code> to
                  the chain.
                </p>
              </li>
              <li>
                <p class="font-medium">
                  Expose it in <code>src/server.ts</code>
                </p>
                <p class="text-sm">
                  Register CRUD procedures for a table with <code>.resource()</code>, or write your
                  own with <code>.procedure()</code>:
                </p>
                <pre class={codeClass}>
                  <code>{`.resource("post")\n.procedure("hello", (base) => base.handler(() => "world"))`}</code>
                </pre>
              </li>
              <li>
                <p class="font-medium">Call it from any page</p>
                <p class="text-sm">
                  Import the type-safe client and use it directly — no fetch, no manual typing:
                </p>
                <pre class={codeClass}>
                  <code>{`import { client } from "$lib/outer";\n\nconst posts = await client.post.list();`}</code>
                </pre>
              </li>
              <li>
                <p class="font-medium">Add a page</p>
                <p class="text-sm">
                  Drop a new file in <code>src/pages</code> — ilha wires up routing for you
                  automatically, just like this one.
                </p>
              </li>
            </ol>
            <Link href="https://github.com/ilhajs/outer/blob/main/SPEC.md" external>
              Outer's full API reference →
            </Link>
          </LayerCard.Content>
        </LayerCard>
      </div>
    );
  });
