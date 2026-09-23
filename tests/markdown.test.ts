import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { Marked } from "marked";
import { renderMarkdown } from "../src/lib/markdown.ts";

test("general Markdown preserves editorial formatting and safe legacy HTML", () => {
  const $ = load(renderMarkdown('# Titel\n\n**Vet** en *cursief*\nVolgende regel\n\n- punt\n\n[Contact](/contact.html)\n\n[Mail](mailto:test@example.com)\n\n![Foto](/assets/foto.jpg)\n\n<strong>HTML</strong><br><a href="tel:+320000000">Bel</a>'));
  assert.equal($("h1").text(), "Titel");
  assert.equal($("strong").length, 2);
  assert.equal($("em").text(), "cursief");
  assert.equal($("li").text(), "punt");
  assert.equal($("br").length, 2);
  assert.equal($("img").attr("src"), "/assets/foto.jpg");
  assert.deepEqual($("a").map((_, node) => $(node).attr("href")).get(), ["/contact.html", "mailto:test@example.com", "tel:+320000000"]);
});

test("stored HTML, encoded executable URLs and embedded active content are removed", () => {
  const $ = load(renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)"><svg onload="alert(1)"></svg><iframe srcdoc="bad"></iframe><style>body{display:none}</style><form action="/steal"><input name="password"></form>\n\n[x](javascript:alert%281%29)\n\n<a href="java&#x73;cript:alert(1)" onclick="alert(1)">x</a>\n\n![x](data:image/svg+xml,bad)'));
  assert.equal($("script, svg, iframe, style, form, [onerror], [onclick], [onload], [srcdoc], [name=password]").length, 0);
  assert.equal($("a[href]").length, 0);
  assert.equal($("img[src^='data:']").length, 0);
  assert.equal($("input").attr("type"), "checkbox");
  assert.notEqual($("input").attr("disabled"), undefined);
});

test("GFM tables, checked tasks and code blocks remain usable", () => {
  const $ = load(renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] Gedaan\n\n```js\nconst x = 1;\n```'));
  assert.equal($("table").length, 1);
  assert.equal($("td").text(), "12");
  assert.notEqual($("input").attr("checked"), undefined);
  assert.notEqual($("input").attr("disabled"), undefined);
  assert.equal($("code").attr("class"), "language-js");
});

test("all default content keeps its visible text and links after sanitization", () => {
  const defaults: unknown = JSON.parse(readFileSync(new URL("../src/data/default-content.json", import.meta.url), "utf8"));
  const markdown = new Marked({ breaks: true, gfm: true });
  function visit(value: unknown) {
    if (typeof value === "string") {
      const before = load(markdown.parse(value, { async: false }));
      const after = load(renderMarkdown(value));
      assert.equal(after("body").text(), before("body").text());
      for (const attribute of ["href", "src"]) {
        const select = `[${attribute}]`;
        assert.deepEqual(after(select).map((_, node) => after(node).attr(attribute)).get(), before(select).map((_, node) => before(node).attr(attribute)).get());
      }
    } else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(defaults);
});
