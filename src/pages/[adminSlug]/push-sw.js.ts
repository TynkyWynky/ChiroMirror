import type { APIRoute } from "astro";
import { getAdminBasePath, isConfiguredAdminPathSlug } from "@/lib/admin-path";
import source from "@/features/app/notifications/service-worker.js?raw";
export const GET: APIRoute = ({ params }) => isConfiguredAdminPathSlug(params.adminSlug)
  ? new Response(`const APP_BUILD = ${JSON.stringify(import.meta.env.PUBLIC_APP_BUILD ?? "local")};\n${source}`, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store", "Service-Worker-Allowed": getAdminBasePath(), "X-Content-Type-Options": "nosniff" } })
  : new Response(null, { status: 404 });
