import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function MetricCard({
  icon: Icon,
  label,
  value,
  valueLabel,
  detail,
  valueClassName
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  valueLabel?: string;
  detail: string;
  valueClassName?: string;
}) {
  return (
    <Card className="relative overflow-hidden bg-background/20">
      <CardContent className="flex items-center gap-4 p-5">
        {value !== undefined && (
          <span className="pointer-events-none absolute -right-2 bottom-0 top-0 flex select-none items-center text-[72px] font-black leading-none text-foreground/[0.04]">
            {value}
          </span>
        )}
        <div className="relative rounded-md border border-primary/20 bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="relative min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-semibold text-foreground", valueClassName)}>{valueLabel ?? value ?? 0}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
