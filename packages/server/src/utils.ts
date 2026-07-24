export function deepMerge({
  a,
  b,
}: {
  a: Record<string, any>;
  b: Record<string, any>;
}): Record<string, any> {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (key in result && typeof result[key] === "object" && typeof b[key] === "object") {
      result[key] = deepMerge({ a: result[key], b: b[key] });
    } else {
      result[key] = b[key];
    }
  }
  return result;
}
