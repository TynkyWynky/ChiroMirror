import type { APIRoute } from "astro";
import { getAdminBasePath, isConfiguredAdminPathSlug } from "@/lib/admin-path";
export const GET: APIRoute = ({ params }) => isConfiguredAdminPathSlug(params.adminSlug)
  ? new Response(JSON.stringify({ id: getAdminBasePath(), name: "Chiro Negenmanneke", short_name: "Chiro", lang: "fr-BE", start_url: getAdminBasePath(), scope: getAdminBasePath(), display: "standalone", background_color: "#f8fafc", theme_color: "#243c32", icons: [{ src: "/assets/Chirologo_700px.png", type: "image/png" }] }), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } })
  : new Response(null, { status: 404 });
