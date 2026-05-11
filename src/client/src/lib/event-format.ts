export function formatEventPayload(payload: string) {
  try {
    return formatValue(JSON.parse(payload));
  } catch {
    return payload;
  }
}

function formatValue(value: unknown, prefix = ""): string {
  if (value == null) {
    return `${prefix || "value"}: null`;
  }
  if (Array.isArray(value)) {
    return value.length === 0
      ? `${prefix || "items"}: none`
      : value.map((entry, index) => formatValue(entry, prefix ? `${prefix}[${index}]` : `[${index}]`)).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${prefix || "value"}: empty`;
    }
    return entries.map(([key, entry]) => formatValue(entry, prefix ? `${prefix}.${key}` : key)).join("\n");
  }
  return `${prefix || "value"}: ${String(value)}`;
}
