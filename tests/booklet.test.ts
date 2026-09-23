import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadBooklet, validateBookletUrl } from "../src/server/booklet.ts";

const project = "https://test-project.supabase.co";
const object = `${project}/storage/v1/object/public/site-media/booklets/boekje.pdf`;

test("booklet only allows public objects in the configured project's site-media bucket", () => {
  assert.equal(validateBookletUrl(object, project)?.href, object);
  assert.ok(validateBookletUrl(object.replace("boekje.pdf", "boekje%20(1).pdf"), project));
  for (const url of [
    "http://127.0.0.1/private", "http://169.254.169.254/latest/meta-data", "https://[::1]/file.pdf",
    "file:///etc/passwd", "https://evil.example/file.pdf", object.replace("test-project", "another-project"),
    object.replace(".supabase.co", ".supabase.co.evil.example"), object.replace("https://", "https://user:pass@"),
    object.replace("/public/", "/authenticated/"), object.replace("site-media/", "private/"),
    `${project}/auth/v1/authorize`, `${project}:8443/storage/v1/object/public/site-media/file.pdf`,
    object.replace("boekje.pdf", "%2e%2e/%2e%2e/auth"), object.replace("boekje.pdf", "%252e%252e%252fsecret"),
    object.replace("boekje.pdf", "%2fsecret"), object.replace("boekje.pdf", "%00file.pdf"), object + "#fragment",
    object + "\n", "not a URL"
  ]) assert.equal(validateBookletUrl(url, project), null, url);
  assert.equal(validateBookletUrl(object, ""), null);
  assert.equal(validateBookletUrl("https://localhost/storage/v1/object/public/site-media/a.pdf", "https://localhost"), null);
});

test("missing or untrusted booklets never cause an outbound request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw Error("Must not fetch"); };
  assert.equal((await downloadBooklet({ url: "", fileName: "" }, project, fetcher)).status, 404);
  assert.equal((await downloadBooklet({ url: "https://evil.example/", fileName: "" }, project, fetcher)).status, 502);
  assert.equal(calls, 0);
});

test("PDF download preserves the body, filename and cache policy and disallows redirects", async () => {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(String(url), object);
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal instanceof AbortSignal);
    return new Response("%PDF-test", { headers: { "Content-Type": "application/pdf; charset=binary" } });
  };
  const response = await downloadBooklet({ url: object, fileName: "Chiro boekje" }, project, fetcher);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "%PDF-test");
  assert.equal(response.headers.get("Content-Disposition"), "attachment; filename*=UTF-8''Chiro%20boekje.pdf");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("network errors, redirects, missing files and non-PDF bodies fail closed", async () => {
  for (const fetcher of [
    async () => { throw Error("network or redirect failure"); },
    async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } }),
    async () => new Response("missing", { status: 404 }),
    async () => new Response("<script>bad</script>", { headers: { "Content-Type": "text/html" } })
  ]) {
    const response = await downloadBooklet({ url: object, fileName: "booklet.pdf" }, project, fetcher);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
