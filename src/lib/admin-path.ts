const DEFAULT_ADMIN_PATH_SLUG = "leiding-login";

function normalizeAdminPathSlug(value: string | undefined) {
  const sanitized = value
    ?.trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || DEFAULT_ADMIN_PATH_SLUG;
}

export function getAdminPathSlug() {
  return normalizeAdminPathSlug(import.meta.env.ADMIN_PATH_SLUG);
}

export function getAdminBasePath() {
  return `/${getAdminPathSlug()}/`;
}

export function getAdminAuthActionPath() {
  return `${getAdminBasePath()}auth-action/`;
}

export function isConfiguredAdminPathSlug(value: string | undefined) {
  return value === getAdminPathSlug();
}
