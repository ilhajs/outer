import { type AdminMeta } from "@outerjs/server";
import { parseSet, toSet } from "@outerjs/server/schema";
import { Button, ClipboardText, Combobox, Icon, Input, Select, Switch, Textarea } from "areia";
import { format } from "date-fns";
import ilha from "ilha";
import { Eye, EyeOff } from "lucide";
import { each, when } from "quando";

export type Column = AdminMeta["tables"][number]["columns"][number];
export type Row = Record<string, unknown>;

/** Column names that should be masked in the grid and record pane (tokens, passwords, …). */
export const SECRET_PATTERN = /token|password|secret/i;

export function isSecretColumn(column: Column): boolean {
  return column.type === "text" && SECRET_PATTERN.test(column.name);
}

// ── Value conversion ────────────────────────────────────────────────────────

/** The PK arrives as a URL segment (string); integer-family PKs must be numbers in `where`. */
export function coercePk(column: Column, raw: string): string | number {
  return column.type === "serial" || column.type === "integer" ? Number(raw) : raw;
}

/** The value a column's form control should display. */
export function toFieldValue(value: unknown, column: Column): string {
  if (value === null || value === undefined) return "";
  if (column.type === "date") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return format(date, "yyyy-MM-dd");
  }
  if (column.type === "timestamp") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) return format(date, "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (column.type === "jsonb") return JSON.stringify(value, null, 2);
  return String(value);
}

type Parsed = { ok: true; value: unknown } | { ok: false; error?: string };

/**
 * Parses a submitted form value back into the column's API type.
 * Empty input parses to `null` for nullable columns; for non-nullable ones it
 * comes back as `{ ok: false }` without an error — the caller decides whether
 * that means "unchanged" (edit) or "omit / required" (create).
 */
/**
 * Reads a column's raw form value. `{ multiple: true }` enums render as a
 * checkbox group — one entry per checked box — which `FormData.get` would
 * truncate to the first, so they're joined back into storage format here.
 */
export function readField(formData: FormData, column: Column): FormDataEntryValue | null {
  if (column.enum && column.multiple) {
    return toSet(formData.getAll(column.name).map(String));
  }
  return formData.get(column.name);
}

export function fromFieldValue(raw: FormDataEntryValue | null, column: Column): Parsed {
  if (column.type === "boolean") {
    // switches serialize like checkboxes: present ("on") when checked, absent otherwise
    return { ok: true, value: raw === "on" || raw === "true" };
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") {
    return column.nullable ? { ok: true, value: null } : { ok: false };
  }
  switch (column.type) {
    case "serial":
    case "integer": {
      const num = Number(text);
      if (!Number.isInteger(num)) return { ok: false, error: `${column.name} must be an integer` };
      return { ok: true, value: num };
    }
    case "real": {
      const num = Number(text);
      if (Number.isNaN(num)) return { ok: false, error: `${column.name} must be a number` };
      return { ok: true, value: num };
    }
    // Exact numerics stay strings end to end — parsing them into a JS number
    // would round the very precision the column exists to preserve.
    case "bigint": {
      if (!/^-?\d+$/.test(text))
        return { ok: false, error: `${column.name} must be a whole number` };
      return { ok: true, value: text };
    }
    case "decimal": {
      if (!/^-?\d+(\.\d+)?$/.test(text)) {
        return { ok: false, error: `${column.name} must be a decimal number` };
      }
      return { ok: true, value: text };
    }
    case "date": {
      const date = new Date(text);
      if (Number.isNaN(date.getTime())) {
        return { ok: false, error: `${column.name} is not a valid date` };
      }
      return { ok: true, value: format(date, "yyyy-MM-dd") };
    }
    case "timestamp": {
      const date = new Date(text);
      if (Number.isNaN(date.getTime()))
        return { ok: false, error: `${column.name} is not a valid date` };
      return { ok: true, value: date.toISOString() };
    }
    case "jsonb":
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return { ok: false, error: `${column.name} is not valid JSON` };
      }
    default:
      return { ok: true, value: text };
  }
}

/** Value-equality against the loaded record, so unchanged fields stay out of the update. */
function sameAsRecord(value: unknown, original: unknown, column: Column): boolean {
  if (value === null || original === null) return value === original;
  if (column.type === "timestamp") {
    return new Date(String(value)).getTime() === new Date(String(original)).getTime();
  }
  if (column.type === "jsonb") return JSON.stringify(value) === JSON.stringify(original);
  return value === original;
}

type BuildResult = { ok: true; data: Row } | { ok: false; error: string };

/**
 * Builds an update payload from the submitted form: parses every editable
 * field and keeps only the ones that differ from the loaded record.
 */
export function buildChanges(formData: FormData, columns: Column[], record: Row): BuildResult {
  const data: Row = {};
  for (const column of columns) {
    if (column.primaryKey) continue;
    const parsed = fromFieldValue(readField(formData, column), column);
    if (!parsed.ok) {
      if (parsed.error) return { ok: false, error: parsed.error };
      continue; // empty non-nullable input — leave the field unchanged
    }
    if (!sameAsRecord(parsed.value, record[column.name] ?? null, column)) {
      data[column.name] = parsed.value;
    }
  }
  return { ok: true, data };
}

/**
 * Builds a create payload from the submitted form. Serial PKs are generated
 * by the database and skipped; other empty fields fall back to the column
 * default when there is one, and are an error otherwise (unless nullable).
 */
export function buildNewRecord(formData: FormData, columns: Column[]): BuildResult {
  const data: Row = {};
  for (const column of columns) {
    if (column.type === "serial") continue;
    const parsed = fromFieldValue(readField(formData, column), column);
    if (!parsed.ok) {
      if (parsed.error) return { ok: false, error: parsed.error };
      if (column.hasDefault) continue; // empty — let the database default apply
      return { ok: false, error: `${column.name} is required` };
    }
    if (parsed.value === null && column.hasDefault) continue;
    data[column.name] = parsed.value;
  }
  return { ok: true, data };
}

// ── Field components ────────────────────────────────────────────────────────

function fieldLabel(column: Column) {
  return (
    <span class="flex items-center gap-1">
      {column.name}
      <span class="text-muted-foreground text-xs font-normal">{column.type}</span>
    </span>
  );
}

/**
 * Masked secret field: ClipboardText (copy real value) + reveal toggle to an
 * editable Areia Input. Hidden input keeps the value in the form while masked.
 */
const SecretRecordField = ilha
  .input<{ column: Column; value?: unknown; disabled?: boolean }>()
  .state("revealed", false)
  .state("draft", (input) => toFieldValue(input.value, input.column!))
  .on("[data-toggle-secret]@click", ({ state, event }) => {
    event.preventDefault();
    state.revealed(!state.revealed());
  })
  .render(({ input, state }) => {
    const column = input.column!;
    const disabled = input.disabled;
    const revealed = state.revealed();
    const draft = state.draft();
    const label = fieldLabel(column);
    const toggle = (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        shape="square"
        data-toggle-secret
        disabled={disabled}
        aria-label={revealed ? "Hide value" : "Show value"}
        aria-pressed={revealed}
        title={revealed ? "Hide" : "Show"}
      >
        <Icon icon={revealed ? EyeOff : Eye} class="size-4" />
      </Button>
    );

    // Exactly one control: ClipboardText (masked) or Input (revealed) — never nested.
    return when(
      revealed,
      () => (
        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium">{label}</span>
            {toggle}
          </div>
          <Input
            name={column.name}
            disabled={disabled}
            type="text"
            autocomplete="off"
            spellcheck={false}
            class="font-mono text-sm"
            bind:value={state.draft}
          />
        </div>
      ),
      () => (
        <div class="grid gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium">{label}</span>
            {toggle}
          </div>
          {/* Hidden so the value still submits while masked. */}
          <input type="hidden" name={column.name} value={draft} disabled={disabled} />
          <ClipboardText
            key={`secret-${column.name}`}
            class="font-mono"
            size="base"
            text="••••••••"
            textToCopy={draft}
          />
        </div>
      ),
    );
  });

/**
 * Multi-value enum field (e.g. `user.role`): a searchable Combobox in multiple
 * mode. Selection lives in island state; a hidden input per selected value keeps
 * the shared FormData pipeline (`readField` → `getAll` → `toSet`) unchanged.
 */
const MultiEnumRecordField = ilha
  .input<{ column: Column; value?: unknown; disabled?: boolean }>()
  .state("selected", (input) => parseSet(input.value))
  .render(({ input, state }) => {
    const column = input.column!;
    const options = column.enum ?? [];
    return (
      <div class="grid gap-1.5">
        <Combobox
          key={`combo-${column.name}`}
          multiple
          label={fieldLabel(column)}
          placeholder="Select values…"
          disabled={input.disabled}
          items={options.map((option) => ({ label: option, value: option }))}
          description={`Any combination of: ${options.join(", ")}`}
          bind:value={state.selected}
        />
        {each(state.selected()).as((option) => (
          <input type="hidden" name={column.name} value={option} disabled={input.disabled} />
        ))}
      </div>
    );
  });

/** One form control for a column, picked by column type. Name/label/value all derive from the schema. */
export function RecordField(props: { column: Column; value?: unknown; disabled?: boolean }) {
  const { column, value, disabled } = props;
  const label = fieldLabel(column);

  if (isSecretColumn(column)) {
    return (
      <SecretRecordField
        key={`secret-field-${column.name}`}
        column={column}
        value={value}
        disabled={disabled}
      />
    );
  }

  // A `{ multiple: true }` enum holds several values at once (user.role), so it
  // gets a searchable multi-select Combobox; each selected value submits under
  // the same name.
  if (column.enum && column.enum.length > 0 && column.multiple) {
    return (
      <MultiEnumRecordField
        key={`field-${column.name}`}
        column={column}
        value={value}
        disabled={disabled}
      />
    );
  }

  // `.enum([...])` columns are a closed set — offer exactly those values.
  if (column.enum && column.enum.length > 0) {
    return (
      <Select
        key={`field-${column.name}`}
        name={column.name}
        label={label}
        disabled={disabled}
        // Non-nullable enums always submit a value, so no empty option for them.
        placeholder={column.nullable ? "—" : undefined}
        items={column.enum.map((option) => ({ label: option, value: option }))}
        value={toFieldValue(value, column)}
      />
    );
  }

  if (column.type === "boolean") {
    return (
      <Switch
        key={`field-${column.name}`}
        name={column.name}
        label={label}
        checked={value === true}
        disabled={disabled}
      />
    );
  }
  if (column.type === "jsonb") {
    return (
      <Textarea
        name={column.name}
        label={label}
        rows={4}
        value={toFieldValue(value, column)}
        disabled={disabled}
      />
    );
  }
  return (
    <Input
      name={column.name}
      label={label}
      disabled={disabled}
      type={when(
        column.type === "timestamp",
        () => "datetime-local",
        () =>
          when(
            column.type === "date",
            () => "date",
            () =>
              when(
                column.type === "serial" || column.type === "integer" || column.type === "real",
                () => "number",
                // bigint/decimal stay text inputs: a number input would coerce
                // through a float and lose precision.
                () => "text",
              ),
          ),
      )}
      step={column.type === "timestamp" ? "1" : undefined}
      placeholder={column.default ?? undefined}
      value={toFieldValue(value, column)}
    />
  );
}
