/**
 * Maps an unknown thrown value to a short, human-readable error message
 * suitable for display in a toast notification.
 */
export function humanizeError(error: unknown): string {
  if (!(error instanceof Error)) return "An unexpected error occurred.";

  const msg = error.message;
  const lower = msg.toLowerCase();

  // Network / connectivity
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed"))
    return "Cannot reach the server. Check your network connection.";

  // Session expired (thrown by api() on 401)
  if (lower === "unauthorized")
    return "Your session has expired. Please log in again.";

  // Permission / scope
  if (lower.includes("only users can") || lower.includes("forbidden") || lower.includes("missing scope"))
    return "You do not have permission to perform this action.";

  // Conflict / already in use
  if (lower.includes("already in use") || lower.includes("credential is in use"))
    return msg; // backend message is already clear ("Credential is in use by ACME certificates")

  if (lower.includes("already exists"))
    return "An item with this name already exists. Choose a different name.";

  // Not found
  if (lower.includes("not found"))
    return "The item no longer exists or has already been deleted.";

  // Zod / input validation
  if (lower.includes("validation error") || lower.includes("invalid"))
    return "The submitted data is not valid. Check the form fields and try again.";

  // ACME / DNS challenge
  if (lower.includes("acme") || lower.includes("challenge") || lower.includes("dns-01"))
    return "ACME validation failed. Check the Cloudflare credentials and ensure the DNS zone is reachable.";

  // Port binding
  if (lower.includes("address already in use") || (lower.includes("port") && lower.includes("in use")))
    return "The specified port is already in use by another service.";

  // Generic internal server error
  if (lower === "internal server error")
    return "An internal server error occurred. Please try again in a moment.";

  // If the message is reasonably short and doesn't look like a raw JS error, show it as-is
  if (msg.length < 160 && !lower.startsWith("typeerror") && !lower.startsWith("syntaxerror") && !lower.startsWith("referenceerror"))
    return msg;

  return "An unexpected error occurred.";
}
