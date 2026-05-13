export function DataTable({
  headers,
  rows,
  emptyMessage = "No items yet."
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="grid grid-cols-1">
        <div className="hidden grid-cols-[repeat(auto-fit,minmax(0,1fr))] bg-secondary/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          {headers.map((header) => (
            <div key={header}>{header}</div>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="grid gap-3 border-t border-border px-4 py-3 text-sm text-foreground md:grid-cols-[repeat(auto-fit,minmax(0,1fr))]"
          >
            {row.map((cell, cellIndex) => (
              <div key={cellIndex} className={cellIndex === row.length - 1 ? "md:text-right" : ""}>
                <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:hidden">
                  {headers[cellIndex]}
                </span>
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
