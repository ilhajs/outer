import { ClipboardText, Radio } from "areia";
import ilha from "ilha";

export const TemplateCloneForm = ilha
  .state("template", "minimal")
  .derived(
    "cloneCommand",
    ({ state }) => `npx giget@latest gh:ilhajs/outer/templates/${state.template()}`,
  )
  .on("input[name=template]@change", ({ state, event }) => {
    state.template((event.target as HTMLInputElement).value);
  })
  .render(({ state, derived }) => (
    <div class="flex w-full flex-col gap-2">
      <Radio.Group legend="Template" name="template" orientation="horizontal">
        <Radio.Item
          label="Minimal"
          value="minimal"
          bind:group={state.template}
          name="template"
          checked
        />
        <Radio.Item label="Ilha" value="ilha" bind:group={state.template} name="template" />
        <Radio.Item
          label="Cloudflare"
          value="cloudflare"
          bind:group={state.template}
          name="template"
        />
        <Radio.Item label="Vercel" value="vercel" bind:group={state.template} name="template" />
      </Radio.Group>
      <ClipboardText
        text={derived.cloneCommand() ?? ""}
        tooltip
        class="w-full max-w-lg px-0.5 text-left sm:px-0"
      />
    </div>
  ));
