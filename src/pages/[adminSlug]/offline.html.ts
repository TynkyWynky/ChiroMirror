import type { APIRoute } from "astro";
import { isConfiguredAdminPathSlug } from "@/lib/admin-path";
import { offlineHtml } from "@/server/pwa";
export const GET: APIRoute = ({params}) => isConfiguredAdminPathSlug(params.adminSlug)
  ? new Response(offlineHtml,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Chiro-Offline":"1","X-Robots-Tag":"noindex, nofollow"}})
  : new Response(null,{status:404});
