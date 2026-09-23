export interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
let pending: InstallPrompt | null = null, listening = false, installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function captureInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); pending = event as InstallPrompt; emit(); });
  window.addEventListener("appinstalled", () => { pending = null; installed = true; emit(); });
}
export function installState() { return { available: Boolean(pending), installed }; }
export function watchInstall(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function promptInstall() {
  const prompt = pending; pending = null; emit();
  if (!prompt) throw new Error("INSTALL_UNAVAILABLE");
  await prompt.prompt(); return (await prompt.userChoice).outcome;
}
const dismissedKey = "chiro.app.install-dismissed";
export function dismissInstall() { try { localStorage.setItem(dismissedKey, String(Date.now())); } catch { /* UI preference only. */ } }
export function installDismissed() { try { return Date.now() - Number(localStorage.getItem(dismissedKey) ?? 0) < 30 * 86400000; } catch { return false; } }
