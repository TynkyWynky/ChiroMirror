export const offlineMessage = "Impossible d’enregistrer sans connexion Internet. Aucune modification n’a été envoyée.";
export function requireOnline() { if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(offlineMessage); }
export function networkError(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "PGRST301" || code === "PGRST303" || code === "401") return "Session expirée. Reconnectez-vous pour continuer.";
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message === offlineMessage) return message;
  if (typeof navigator !== "undefined" && navigator.onLine === false || /fetch|network|internet|load failed|réseau/i.test(message)) return "Connexion indisponible. L’enregistrement n’est pas confirmé ; vérifiez les données après reconnexion avant de réessayer.";
  return null;
}
