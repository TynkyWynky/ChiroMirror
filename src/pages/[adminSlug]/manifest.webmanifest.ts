import type { APIRoute } from "astro";
import { getAdminBasePath, isConfiguredAdminPathSlug } from "@/lib/admin-path";
import { appManifest } from "@/server/pwa";
export const GET: APIRoute = ({ params }) => isConfiguredAdminPathSlug(params.adminSlug)
  ? new Response(JSON.stringify(appManifest(getAdminBasePath())), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } })
  : new Response(null, { status: 404 });
