export const appScreens = ["home", "agenda", "tasks", "finance", "members", "settings", "notifications"] as const;
export type AppScreen = typeof appScreens[number];
export interface AppRoute { screen: AppScreen; task?: string; event?: string; occurrence?: string; notification?: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readAppRoute(search: string): AppRoute | null {
  const p = new URLSearchParams(search), screen = p.get("app");
  const validId = (key: string) => uuid.test(p.get(key) ?? "") ? p.get(key)! : undefined;
  const task = validId("task"), event = validId("event"), notification = validId("notification");
  if (!screen && !task && !event && !notification) return null;
  const route: AppRoute = { screen: appScreens.includes(screen as AppScreen) ? screen as AppScreen : "home" };
  if (notification) return { screen: "notifications", notification };
  if (task) return { screen: "tasks", task };
  if (event) {
    const day = p.get("occurrence") ?? "";
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
    return { screen: "agenda", event, occurrence: validDay ? day : undefined };
  }
  return route;
}
export function appRouteUrl(basePath: string, route: AppRoute) {
  const params = new URLSearchParams({ app: route.screen });
  if (route.screen === "tasks" && route.task && uuid.test(route.task)) params.set("task",route.task);
  if (route.screen === "agenda" && route.event && uuid.test(route.event)) { params.set("event",route.event); if (route.occurrence && /^\d{4}-\d{2}-\d{2}$/.test(route.occurrence)) params.set("occurrence",route.occurrence); }
  if (route.screen === "notifications" && route.notification && uuid.test(route.notification)) params.set("notification",route.notification);
  if (!/^\/[a-z0-9-]+\/$/.test(basePath)) throw new Error("Ongeldig APP-pad");
  return `${basePath}?${params}`;
}
