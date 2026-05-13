import { useEffect, useState } from "react";

export type AcmeProgressStep = {
  step: string;
  status: "running" | "done" | "error";
  detail?: string;
};

export function useAcmeProgress() {
  const [steps, setSteps] = useState<AcmeProgressStep[]>([]);

  const start = () => setSteps([]);

  const clear = () => setSteps([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const msg = (event as CustomEvent<{ step: string; status: "running" | "done" | "error"; detail?: string }>).detail;
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.step === msg.step);
        const entry: AcmeProgressStep = { step: msg.step, status: msg.status, detail: msg.detail };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = entry;
          return next;
        }
        return [...prev, entry];
      });
    };

    window.addEventListener("acme-progress", handler);
    return () => window.removeEventListener("acme-progress", handler);
  }, []);

  return { steps, start, clear };
}
