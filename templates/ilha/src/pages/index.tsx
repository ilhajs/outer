import { client } from "$lib/outer";
import { type InferLoader, loader, redirect } from "@ilha/router";
import { extractFormData, preventDefault } from "@ilha/store/form";
import { Button, Checkbox, Input, LayerCard, Link } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";

export const clientLoad = loader(async ({ signal, head }) => {
  const authSession = await client.auth.getSession({ fetchOptions: { signal } });
  if (!authSession.data) redirect("/login");
  const todos = await client.todo.list({ orderBy: [{ createdAt: "desc" }] }, { signal });
  head({ title: "Home" });
  return { todos };
});

const codeClass = "bg-areia-background rounded-lg p-3 text-sm overflow-x-auto";

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .derived("todos", ({ input }) => input.todos ?? [])
  .on(
    "#create-todo@submit",
    preventDefault(async ({ target, derived }) => {
      const form = target as HTMLFormElement;
      const data = extractFormData(form);
      if (typeof data.title !== "string") return;
      const todoData = { id: crypto.randomUUID(), title: data.title };
      const placeholder = {
        ...todoData,
        description: "",
        userId: "",
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const previous = derived.todos() ?? [];
      derived.todos([placeholder, ...previous]);
      form.reset();
      try {
        const todo = await client.todo.create(todoData);
        derived.todos((derived.todos() ?? []).map((t) => (t.id === todoData.id ? todo : t)));
      } catch {
        derived.todos(previous);
        toast.error("Could not create the todo");
      }
    }),
  )
  .on("[data-todo-id]@change", async ({ target }) => {
    if (!(target instanceof HTMLInputElement)) return;
    const todoId = target.dataset.todoId;
    if (!todoId) return;
    const completed = target.checked;
    try {
      await client.todo.update({
        where: { id: todoId },
        data: { completed },
      });
    } catch {
      target.checked = !completed;
      toast.error("Could not update the todo");
    }
  })
  .on("[data-delete-todo]@click", async ({ target, derived }) => {
    if (!(target instanceof HTMLButtonElement)) return;
    const todoId = target.dataset.deleteTodo;
    if (!todoId) return;
    const previous = derived.todos() ?? [];
    derived.todos(previous.filter((todo) => todo.id !== todoId));
    try {
      await client.todo.delete({ id: todoId });
    } catch {
      derived.todos(previous);
      toast.error("Could not delete the todo");
    }
  })
  .render(({ derived }) => (
    <div class="flex flex-col items-start gap-4 lg:flex-row">
      <LayerCard>
        <LayerCard.Title>Todos</LayerCard.Title>
        <LayerCard.Content class="flex flex-col gap-4">
          <form id="create-todo" class="flex items-center gap-2">
            <Input name="title" placeholder="Task title" class="flex-1" required />
            <Button type="submit">Create</Button>
          </form>
          <div class="flex flex-col gap-2">
            {derived.todos()?.map((todo) => (
              <div key={todo.id} class="flex items-center justify-between">
                <Checkbox label={todo.title} data-todo-id={todo.id} checked={todo.completed} />
                <Button data-delete-todo={todo.id}>Delete</Button>
              </div>
            ))}
          </div>
        </LayerCard.Content>
      </LayerCard>
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
  ));
