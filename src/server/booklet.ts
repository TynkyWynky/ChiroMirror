export interface BookletSource { url: string; fileName: string }

/** Fetch only public objects in this project's hosted Supabase bucket. */
export function validateBookletUrl(value: string, configuredSupabaseUrl: string): URL | null {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(value)) return null;
    const project = new URL(configuredSupabaseUrl);
    const source = new URL(value);
    if (project.protocol !== "https:" || project.port ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname)) return null;
    if (source.origin !== project.origin || source.username || source.password || source.hash) return null;
    const prefix = "/storage/v1/object/public/site-media/";
    if (!source.pathname.startsWith(prefix) || source.pathname.length === prefix.length) return null;
    const segments = source.pathname.slice(prefix.length).split("/");
    if (segments.some(segment => {
      const decoded = decodeURIComponent(segment);
      return decoded === "." || decoded === ".." || /[\\/\u0000-\u001f\u007f%]/.test(decoded);
    })) return null;
    return source;
  } catch {
    return null;
  }
}

function failure(message: string, status: number) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store" } });
}

function safeFileName(value: string) {
  const name = value.trim().replace(/[\u0000-\u001f\u007f/\\?%*:|"<>]/g, "-").slice(0, 180);
  return name.toLowerCase().endsWith(".pdf") ? name : `${name || "boekje"}.pdf`;
}

export async function downloadBooklet(source: BookletSource, supabaseUrl: string, fetcher: typeof fetch = fetch) {
  if (!source.url.trim()) return failure("Boekje niet gevonden.", 404);
  const url = validateBookletUrl(source.url.trim(), supabaseUrl);
  if (!url) return failure("Boekje URL is niet toegelaten.", 502);
  try {
    const upstream = await fetcher(url, {
      headers: { Accept: "application/pdf" }, redirect: "error", signal: AbortSignal.timeout(10_000)
    });
    const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (upstream.status !== 200 || !upstream.body || contentType !== "application/pdf") {
      await upstream.body?.cancel();
      return failure("Boekje kon niet geladen worden.", 502);
    }
    return new Response(upstream.body, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(source.fileName))}`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    } });
  } catch {
    return failure("Boekje kon niet geladen worden.", 502);
  }
}
