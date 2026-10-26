import type { APIRoute } from "astro";
import { loadSiteContent } from "@/lib/content";
import { publicNavLinks } from "@/lib/routes";
import { groupHref } from "@/lib/group-presentation";

const escapeXml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
})[character]!);

export const GET: APIRoute = async ({ site }) => {
  const { siteSettings, groups } = await loadSiteContent();
  let base = site ?? new URL("https://www.chironegenmanneke.be");
  try { base = new URL(siteSettings.siteUrl); } catch { /* Same configured fallback as public SEO. */ }
  const paths = new Set(["/", ...publicNavLinks.map(link => link.href), "/leiding.html", "/geschiedenis.html", ...groups.filter(group => group.slug).map(group => groupHref(group.slug))]);
  const urls = [...paths].map(path => `<url><loc>${escapeXml(new URL(path, base).href)}</loc></url>`).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
};
