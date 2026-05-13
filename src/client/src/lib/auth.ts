const TOKEN_KEY = "aegis_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    // Decode the payload without verifying (signature is checked server-side).
    // Just check the exp claim so we don't send obviously expired tokens.
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64)) as { exp?: number };
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearToken();
      return false;
    }
    return true;
  } catch {
    clearToken();
    return false;
  }
}
