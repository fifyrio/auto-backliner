import test from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, cleanDomain, renderTemplate, rootDomain, safeHttpUrl, toCsv } from "../src/shared/util.js";

test("rootDomain strips protocol, path and www", () => {
  assert.equal(rootDomain("https://www.Example.com/a/b?x=1"), "example.com");
  assert.equal(rootDomain("blog.example.com"), "blog.example.com");
  assert.equal(rootDomain(""), "");
});

test("safeHttpUrl rejects javascript: and data: URLs", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,<script>"), "");
  assert.equal(safeHttpUrl("https://ok.com/x"), "https://ok.com/x");
});

test("canonicalUrl drops hash and tracking params so the same page dedupes", () => {
  assert.equal(
    canonicalUrl("https://a.com/post?utm_source=x&id=3#comments"),
    "https://a.com/post?id=3"
  );
  assert.equal(canonicalUrl("ftp://a.com"), "");
});

test("cleanDomain normalises user input", () => {
  assert.equal(cleanDomain(" HTTPS://www.Foo.com/bar "), "foo.com");
});

test("renderTemplate fills placeholders and spins synonyms", () => {
  const out = renderTemplate("Nice {post|write-up} — see {site} for {anchor}.", {
    site: "https://s.com",
    anchor: "tools",
  });
  assert.match(out, /^Nice (post|write-up) — see https:\/\/s\.com for tools\.$/);
});

test("renderTemplate leaves unknown placeholders untouched", () => {
  assert.equal(renderTemplate("hi {nope}", { site: "x" }), "hi {nope}");
});

test("toCsv escapes quotes, commas and newlines", () => {
  const csv = toCsv([{ a: 'say "hi", ok', b: "line\n2" }], ["a", "b"]);
  assert.ok(csv.includes('"say ""hi"", ok"'));
  assert.ok(csv.includes('"line\n2"'));
});
