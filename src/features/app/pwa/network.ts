export const offlineMessage = "Opslaan kan niet zonder internetverbinding. Er zijn geen wijzigingen verstuurd.";
export function requireOnline() { if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(offlineMessage); }
export function networkError(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "PGRST301" || code === "PGRST303" || code === "401") return "Je sessie is verlopen. Meld je opnieuw aan om verder te gaan.";
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message === offlineMessage) return message;
  if (typeof navigator !== "undefined" && navigator.onLine === false || /fetch|network|internet|load failed|réseau/i.test(message)) return "Geen verbinding. Het opslaan is niet bevestigd. Controleer na het herstellen van de verbinding eerst de gegevens voordat je opnieuw probeert.";
  return null;
}
