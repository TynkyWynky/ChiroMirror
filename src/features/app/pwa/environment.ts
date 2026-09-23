export function installedContext() {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
}
export function appleMobile() {
  return typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
export function appScope() { return `/${location.pathname.split("/").filter(Boolean)[0] ?? ""}/`.replace("//", "/"); }
export async function registerAppWorker() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) throw new Error("SW_UNAVAILABLE");
  return navigator.serviceWorker.register(`${appScope()}push-sw.js`, { scope: appScope(), updateViaCache: "none" });
}
export const appBuild = import.meta.env?.PUBLIC_APP_BUILD ?? "local";
