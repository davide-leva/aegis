import { cn } from "@/lib/utils";

export function SimpleTable({
  headers,
  rows,
  alignLastRight = true,
  emptyMessage = "No data yet."
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  alignLastRight?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary/60 text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn(
                  "px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em]",
                  alignLastRight && i === headers.length - 1 ? "text-right" : ""
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, ri) => (
              <tr key={ri} className="border-t border-border/80">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cn("px-4 py-3 align-top", alignLastRight && ci === row.length - 1 ? "text-right" : "")}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
