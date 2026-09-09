import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "cheerio";
import { getPublishedPosts, getPostPublishError } from "../src/lib/posts.ts";
import { getPostPreview, imageToMarkdown, renderPostMarkdown } from "../src/lib/post-markdown.ts";
import type { Post } from "../src/types/content.ts";

function post(overrides: Partial<Post> = {}): Post {
  return {
    title: "Nieuws", summary: "", body: "Welkom!", eventDate: "2026-09-09",
    published: true, featured: false, ...overrides
  };
}

test("the homepage only shows published featured posts; the feed keeps other published posts", () => {
  const input = [
    post({ id: "regular" }),
    post({ id: "draft", featured: true, published: false }),
    post({ id: "old", featured: true, eventDate: "2026-08-01" }),
    post({ id: "new", featured: true })
  ];
  assert.deepEqual(getPublishedPosts(input, true).map((item) => item.id), ["new", "old"]);
  assert.deepEqual(getPublishedPosts(input).map((item) => item.id), ["new", "old", "regular"]);
  assert.equal(input[0].id, "regular");
  assert.deepEqual(getPublishedPosts(input.map((item) => ({ ...item, published: false })), true), []);
});

test("a text-only or image-only post needs no summary to publish", () => {
  assert.equal(getPostPublishError(post()), null);
  assert.equal(getPostPublishError(post({ body: imageToMarkdown("/assets/kampfoto.jpg", "Kampfoto") })), null);
  assert.ok(getPostPublishError(post({ title: "  " })));
  assert.ok(getPostPublishError(post({ body: "\n " })));
});

test("multiple uploaded images stay between surrounding text and retain their URLs", () => {
  const url = "https://example.com/photos/foto%20(1).jpg";
  const source = `Eerste alinea.\n\n${imageToMarkdown(url, 'Kamp [2026] "foto"')}\n\nTweede alinea.\n\n${imageToMarkdown("/assets/banner.jpg", "Samen spelen")}\n\nTot zondag!`;
  const $ = load(renderPostMarkdown(source));
  assert.equal($("img").length, 2);
  assert.equal($("img").first().attr("src"), url);
  assert.equal($("img").first().attr("alt"), 'Kamp [2026] "foto"');
  assert.match($("body").text(), /Eerste alinea\.[\s\S]*Tweede alinea\.[\s\S]*Tot zondag!/);
  assert.equal($("img").first().parent().prev().text(), "Eerste alinea.");
  assert.equal($("img").first().parent().next().text(), "Tweede alinea.");
});

test("preview and public rendering escape raw HTML and block executable links", () => {
  const $ = load(renderPostMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[klik](javascript:alert%281%29)\n\n![foto](data:text/html,test)\n\n[klik](java&#x73;cript:alert%281%29)'));
  assert.equal($("script, img, a, [onerror]").length, 0);
  assert.match($("body").text(), /<script>/);
  const safe = load(renderPostMarkdown("**Welkom**\n\n[Contact](/contact.html)\n\n![Kamp](/assets/kampfoto.jpg)"));
  assert.equal(safe("strong").text(), "Welkom");
  assert.equal(safe("a").attr("href"), "/contact.html");
  assert.equal(safe("img").attr("src"), "/assets/kampfoto.jpg");
});

test("homepage preview finds the first safe image and bounds the excerpt", () => {
  const preview = getPostPreview(`![geen foto](javascript:alert%281%29)\n\n${imageToMarkdown("/assets/kampfoto.jpg", "Kamp")}\n\n${"Samen spelen. ".repeat(40)}`);
  assert.equal(preview.image?.url, "/assets/kampfoto.jpg");
  assert.ok(preview.excerpt.length <= 220);
  assert.ok(preview.excerpt.endsWith("…"));
  assert.equal(getPostPreview("Gewoon een bericht.").image, undefined);
  assert.equal(getPostPreview(imageToMarkdown("/assets/kampfoto.jpg", "Kampfoto")).excerpt, "");
});
