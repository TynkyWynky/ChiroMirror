/** Shared public presentation helpers; CMS records remain unchanged. */
export function groupHref(slug: string) {
  return slug ? `/groepen/${encodeURIComponent(slug)}/` : "/groepen.html";
}

export function groupImageUrl(url: string) {
  const aliases: Record<string, string> = {
    "/assets/tito.jpg": "/assets/tito-cover.jpg", "/assets/Tito.jpg": "/assets/tito-cover.jpg",
    "/assets/keti.jpg": "/assets/keti-cover.jpg", "/assets/Keti.jpg": "/assets/keti-cover.jpg"
  };
  return aliases[url] ?? url;
}

export function groupAgeLabel(ageRange: string) {
  return ageRange && !/jaar/i.test(ageRange) ? `${ageRange} jaar` : ageRange;
}
