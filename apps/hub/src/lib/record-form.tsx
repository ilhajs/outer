import type { AdminMeta } from "@outerjs/server";
import { Input, Switch, Textarea } from "areia";
import { format } from "date-fns";
import { when } from "quando";

export type Column = AdminMeta["tables"][number]["columns"][number];
export type Row = Record<string, unknown>;

// ── Value conversion ────────────────────────────────────────────────────────

/** The PK arrives as a URL segment (string); integer-family PKs must be numbers in `where`. */
export function coercePk(column: Column, raw: string): string | number {
  return column.type === "serial" || column.type === "integer" ? Number(raw) : raw;
}

/** The value a column's form control should display. */
export function toFieldValue(value: unknown, column: Column): string {
  if (value === null || value === undefined) return "";
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
    const parsed = fromFieldValue(formData.get(column.name), column);
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
    const parsed = fromFieldValue(formData.get(column.name), column);
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

// ── Field component ─────────────────────────────────────────────────────────

/** One form control for a column, picked by column type. Name/label/value all derive from the schema. */
export function RecordField(props: { column: Column; value?: unknown; disabled?: boolean }) {
  const { column, value, disabled } = props;
  const label = (
    <span class="flex items-center gap-1">
      {column.name}
      <span class="text-muted-foreground text-xs font-normal">{column.type}</span>
    </span>
  );

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
            column.type === "serial" || column.type === "integer",
            () => "number",
            () => "text",
          ),
      )}
      step={column.type === "timestamp" ? "1" : undefined}
      placeholder={column.default ?? undefined}
      value={toFieldValue(value, column)}
    />
  );
}
