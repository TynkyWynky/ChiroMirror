import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPublicPosts, getPostMonths, getPublicPostDate } from "../src/lib/public-posts.ts";
import { getPublishedPosts } from "../src/lib/posts.ts";
import type { Post } from "../src/types/content.ts";

const post = (overrides: Partial<Post> = {}): Post => ({ title: "Nieuws", summary: "", body: "Welkom!", eventDate: "", published: true, featured: false, ...overrides });

test("date-only editorial dates stay on their Belgian calendar day, including DST changes", () => {
  assert.equal(getPublicPostDate(post({ eventDate: "2026-03-29" }))?.label, "29 maart 2026");
  assert.equal(getPublicPostDate(post({ eventDate: "2026-10-25" }))?.day, "25");
  assert.equal(getPublicPostDate(post({ eventDate: "2024-02-29" }))?.monthKey, "2024-02");
});

test("invalid dates are not rolled into another month; missing dates stay missing", () => {
  for (const eventDate of ["", "2026-02-29", "2026-02-30", "2026-13-01", "morgen", "2026-10-26T12:00:00", "2026-02-30T12:00:00Z"]) {
    assert.equal(getPublicPostDate(post({ eventDate })), null, eventDate);
  }
});

test("creation timestamps use Brussels time at month/year and DST boundaries with a truthful label", () => {
  const date = getPublicPostDate(post({ createdAt: "2026-12-31T23:30:00Z" }));
  assert.equal(date?.monthKey, "2027-01");
  assert.equal(date?.label, "1 januari 2027");
  assert.equal(date?.source, "created");
  assert.equal(getPublicPostDate(post({ createdAt: "2026-03-31T22:30:00Z" }))?.monthKey, "2026-04");
  assert.equal(getPublicPostDate(post({ eventDate: "invalid", createdAt: "2026-10-26T09:00:00+00:00" }))?.source, "created");
});

test("month/search/highlight filters preserve public visibility, ordering and undated posts in the unfiltered feed", () => {
  const posts = getPublishedPosts([
    post({ id: "draft", published: false, eventDate: "2026-12-01" }),
    post({ id: "highlight", featured: true, eventDate: "2026-09-10", title: "Café bij de Chiro" }),
    post({ id: "ordinary", eventDate: "2026-10-26", body: "Breng je laarzen mee." }),
    post({ id: "undated" })
  ]);
  assert.deepEqual(getPostMonths(posts).map(([key]) => key), ["2026-10", "2026-09"]);
  assert.deepEqual(filterPublicPosts(posts, { query: "", month: "", featured: false }).map(p => p.id), ["highlight", "ordinary", "undated"]);
  assert.deepEqual(filterPublicPosts(posts, { query: "CAFE", month: "2026-09", featured: true }).map(p => p.id), ["highlight"]);
  assert.deepEqual(filterPublicPosts(posts, { query: "laarzen", month: "2026-10", featured: false }).map(p => p.id), ["ordinary"]);
  assert.equal(filterPublicPosts(posts, { query: "onbestaand", month: "", featured: false }).length, 0);
});
