import { Label } from "@/components/ui/label";

export function Field({
  label,
  children,
  className,
  error
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-sm text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
