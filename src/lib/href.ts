export function withDevFresh(href: string) {
  if (!import.meta.env.DEV) {
    return href;
  }

  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  ) {
    return href;
  }

  const [pathWithQuery, hash = ""] = href.split("#");
  const separator = pathWithQuery.includes("?") ? "&" : "?";
  const freshHref = `${pathWithQuery}${separator}fresh=1`;

  return hash ? `${freshHref}#${hash}` : freshHref;
}
