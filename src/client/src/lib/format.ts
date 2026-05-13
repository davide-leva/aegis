export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}
