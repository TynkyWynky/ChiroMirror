import type { Post } from "../types/content.ts";

const locale = "nl-BE";
const timeZone = "Europe/Brussels";

function parseDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  }
  // An offset is required; never infer a server/browser-local time zone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const day = value.slice(0, 10);
  if (!parseDate(day)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** A post's editorial date is not proof of a scheduled event. */
export function getPublicPostDate(post: Pick<Post, "eventDate" | "createdAt">) {
  for (const [value, source] of [[post.eventDate, "date"], [post.createdAt, "created"]] as const) {
    const date = parseDate(value ?? "");
    if (!date) continue;
    const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", timeZone }).formatToParts(date);
    const year = parts.find(part => part.type === "year")!.value;
    const month = parts.find(part => part.type === "month")!.value;
    return {
      datetime: value!, source, year, monthKey: `${year}-${month}`,
      label: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone }).format(date),
      day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone }).format(date),
      monthShort: new Intl.DateTimeFormat(locale, { month: "short", timeZone }).format(date),
      monthLabel: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone }).format(date)
    };
  }
  return null;
}

export function getPostMonths(posts: Post[]) {
  const months = new Map<string, string>();
  for (const post of posts) {
    const date = getPublicPostDate(post);
    if (date) months.set(date.monthKey, date.monthLabel);
  }
  return [...months].sort(([a], [b]) => b.localeCompare(a));
}

export interface PublicPostFilters { query: string; month: string; featured: boolean; }
const searchText = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase(locale);

/** Filter the already public, ordered feed without changing publishing or ordering rules. */
export function filterPublicPosts(posts: Post[], filters: PublicPostFilters) {
  const query = searchText(filters.query.trim());
  return posts.filter(post => (!filters.featured || post.featured)
    && (!filters.month || getPublicPostDate(post)?.monthKey === filters.month)
    && (!query || searchText(`${post.title}\n${post.summary}\n${post.body}`).includes(query)));
}
