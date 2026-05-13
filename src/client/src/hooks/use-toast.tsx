import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ToastVariant = "error" | "success" | "info";

type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastFn = (opts: { title: string; description?: string; variant?: ToastVariant }) => void;

// ─── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastFn>(() => {});

// ─── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback<ToastFn>(({ title, description, variant = "info" }) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { id, title, description, variant }]);
    timers.current.set(id, setTimeout(() => dismiss(id), 6000));
  }, [dismiss]);

  return (
    <ToastContext.Provider value={add}>
      {children}
      <ToastList toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useToast() {
  const add = useContext(ToastContext);

  return {
    toast: add,
    error: (title: string, description?: string) => add({ title, description, variant: "error" }),
    success: (title: string, description?: string) => add({ title, description, variant: "success" }),
    info: (title: string, description?: string) => add({ title, description, variant: "info" }),
  };
}

// ─── Toast list UI ─────────────────────────────────────────────────────────────

function ToastList({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

const VARIANT_STYLES: Record<ToastVariant, { container: string; icon: React.ReactNode }> = {
  error: {
    container: "border-red-500/30 bg-red-950/90 text-red-100",
    icon: <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />,
  },
  success: {
    container: "border-emerald-500/30 bg-emerald-950/90 text-emerald-100",
    icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />,
  },
  info: {
    container: "border-border bg-card/95 text-foreground",
    icon: <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />,
  },
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const { container, icon } = VARIANT_STYLES[toast.variant];

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur animate-in slide-in-from-right-4 fade-in duration-200 ${container}`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs opacity-80 leading-relaxed">{toast.description}</p>
        ) : null}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity -mr-1 -mt-0.5 p-0.5"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
