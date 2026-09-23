import type { APIRoute } from "astro";
import { loadSiteContent } from "@/lib/content";
import { downloadBooklet } from "@/server/booklet";

export const GET: APIRoute = async () => {
  const { pages } = await loadSiteContent();
  return downloadBooklet({
    url: pages.activities.bookletUrl ?? "",
    fileName: pages.activities.bookletFileName ?? "boekje.pdf"
  }, import.meta.env.PUBLIC_SUPABASE_URL ?? "");
};
