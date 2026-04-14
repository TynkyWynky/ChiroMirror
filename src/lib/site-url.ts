const FALLBACK_SITE_URL = "https://www.chironegenmanneke.be";

function normalizeSiteUrl(value: string | undefined) {
  const candidate = value?.trim();

  if (!candidate) {
    return FALLBACK_SITE_URL;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export function getPublicSiteUrl() {
  return normalizeSiteUrl(import.meta.env.PUBLIC_SITE_URL);
}

export function toPublicSiteUrl(path: string) {
  return new URL(path, getPublicSiteUrl()).toString();
}
