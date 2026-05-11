import type { ProxyRoute } from "../types.js";

export const HTTP_PROXY_LISTEN_PORT = 80;
export const HTTPS_PROXY_LISTEN_PORT = 443;

export function isHttpFamilyProtocol(protocol: ProxyRoute["protocol"]) {
  return protocol === "http" || protocol === "https";
}

export function getCanonicalProxyListener(protocol: ProxyRoute["protocol"], _listenAddress: string) {
  if (protocol === "http") {
    return {
      listenAddress: "0.0.0.0",
      listenPort: HTTP_PROXY_LISTEN_PORT
    };
  }

  if (protocol === "https") {
    return {
      listenAddress: "0.0.0.0",
      listenPort: HTTPS_PROXY_LISTEN_PORT
    };
  }

  return null;
}
