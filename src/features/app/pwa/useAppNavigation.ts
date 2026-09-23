import { useEffect, useState } from "preact/hooks";
import type { TabId } from "../../../components/admin/navigation";
import { appRouteUrl, readAppRoute, type AppRoute, type AppScreen } from "./routes";
import { appScope, installedContext } from "./environment";
export function useAppNavigation() {
  const [state, setState] = useState<{ tab: TabId; route: AppRoute | null }>({ tab: "overview", route: null });
  useEffect(() => {
    const restore = () => {
      const route = readAppRoute(location.search) ?? (installedContext() ? { screen: "home" as const } : null);
      setState({ tab: route ? `app-${route.screen}` : "overview", route });
    };
    restore(); window.addEventListener("popstate",restore); return () => window.removeEventListener("popstate",restore);
  }, []);
  function navigate(tab: TabId, route?: AppRoute, replace = false) {
    const next = tab.startsWith("app-") ? route ?? { screen: tab.slice(4) as AppScreen } : null;
    const url = next ? appRouteUrl(appScope(),next) : appScope();
    if (`${location.pathname}${location.search}` !== url) history[replace ? "replaceState" : "pushState"](null,"",url);
    setState({ tab, route: next });
  }
  return { activeTab: state.tab, route: state.route, navigate };
}
