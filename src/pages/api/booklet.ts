import type { APIRoute } from "astro";
import { loadSiteContent } from "@/lib/content";

function getSafeFileName(value: string) {
  const normalized = value.trim().replace(/[/\\?%*:|"<>]/g, "-");
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized || "boekje"}.pdf`;
}

export const GET: APIRoute = async () => {
  const content = await loadSiteContent();
  const bookletUrl = content.pages.activities.bookletUrl?.trim();
  const bookletFileName = getSafeFileName(content.pages.activities.bookletFileName ?? "boekje.pdf");

  if (!bookletUrl) {
    return new Response("Boekje niet gevonden.", {
      status: 404,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(bookletUrl);
  } catch {
    return new Response("Boekje URL is ongeldig.", {
      status: 500,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }

  const upstream = await fetch(sourceUrl, {
    headers: {
      Accept: "application/pdf"
    }
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Boekje kon niet geladen worden.", {
      status: 502,
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(bookletFileName)}`,
      "Cache-Control": "no-store"
    }
  });
};
