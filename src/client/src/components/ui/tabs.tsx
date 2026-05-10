import * as React from "react";

import { cn } from "@/lib/utils";

interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: string }[];
}

export function Tabs({ value, onValueChange, tabs }: TabsProps) {
  return (
    <div className="inline-flex rounded-md border border-border bg-secondary/70 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          className={cn(
            "rounded-md px-3 py-2 text-sm transition-colors",
            value === tab.value ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onValueChange(tab.value)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
