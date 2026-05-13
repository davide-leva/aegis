import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { clearToken, getToken } from "@/lib/auth";

export function useWsInvalidation() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    function connect() {
      const currentToken = getToken();
      if (!currentToken) return;

      ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(currentToken)}`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type: string; keys?: string[]; operationId?: string; step?: string; status?: string; detail?: string };
          if (msg.type === "invalidate" && Array.isArray(msg.keys)) {
            for (const key of msg.keys) {
              void queryClient.invalidateQueries({ queryKey: [key] });
            }
          }
          if (msg.type === "acme-progress") {
            window.dispatchEvent(new CustomEvent("acme-progress", { detail: msg }));
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        if (event.code === 4001) {
          // Server rejected the token — clear it so the user is sent to login
          clearToken();
          window.location.href = "/login";
          return;
        }
        if (!dead) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      dead = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [queryClient]);
}
