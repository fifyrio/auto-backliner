import test from "node:test";
import assert from "node:assert/strict";
import { addManual, mergeBacklinks, removeMany, setStatus, lastPostedAtByRoot } from "../src/bg/candidates.js";
import { CANDIDATE_STATUS, DEFAULT_SETTINGS } from "../src/shared/constants.js";

const settings = { ...DEFAULT_SETTINGS, perRootLimit: 2 };
const link = (url, extra = {}) => ({ urlFrom: url, urlTo: "https://target.com", ...extra });

test("mergeBacklinks caps candidates per root domain", () => {
  const links = [
    link("https://blog.com/a"),
    link("https://blog.com/b"),
    link("https://blog.com/c"),
    link("https://other.com/a"),
  ];
  const res = mergeBacklinks({}, links, "target.com", settings);
  assert.equal(res.added, 3);
  assert.equal(res.skipped.rootLimit, 1);
});

test("mergeBacklinks treats hash-only variants as duplicates", () => {
  const first = mergeBacklinks({}, [link("https://blog.com/a")], "t.com", settings);
  const second = mergeBacklinks(first.candidates, [link("https://blog.com/a#comment-9")], "t.com", settings);
  assert.equal(second.added, 0);
  assert.equal(second.skipped.duplicate, 1);
});

test("mergeBacklinks filters by minimum DR and dofollow flag", () => {
  const strict = { ...settings, minDomainRating: 40, dofollowOnly: true };
  const res = mergeBacklinks({}, [
    link("https://low.com/a", { domainRating: 10, inRendered: true }),
    link("https://nofollow.com/a", { domainRating: 80, inRendered: false }),
    link("https://good.com/a", { domainRating: 80, inRendered: true }),
  ], "t.com", strict);
  assert.equal(res.added, 1);
  assert.equal(res.skipped.lowDr, 1);
  assert.equal(res.skipped.nofollow, 1);
  assert.ok(res.candidates["https://good.com/a"]);
});

test("mergeBacklinks skips entries with unusable URLs", () => {
  const res = mergeBacklinks({}, [link("javascript:alert(1)"), link("")], "t.com", settings);
  assert.equal(res.added, 0);
  assert.equal(res.skipped.invalid, 2);
});

test("mergeBacklinks does not mutate the input map", () => {
  const before = {};
  mergeBacklinks(before, [link("https://blog.com/a")], "t.com", settings);
  assert.deepEqual(before, {});
});

test("setStatus returns a new map and keeps other entries", () => {
  const { candidates } = mergeBacklinks({}, [link("https://a.com/p"), link("https://b.com/p")], "t", settings);
  const next = setStatus(candidates, "https://a.com/p", CANDIDATE_STATUS.POSTED, "done");
  assert.equal(next["https://a.com/p"].status, CANDIDATE_STATUS.POSTED);
  assert.equal(candidates["https://a.com/p"].status, CANDIDATE_STATUS.NEW);
  assert.equal(next["https://b.com/p"].status, CANDIDATE_STATUS.NEW);
});

test("addManual ignores a page already in the library", () => {
  const first = addManual({}, { url: "https://x.com/p", title: "T" });
  const second = addManual(first.candidates, { url: "https://x.com/p#a", title: "T" });
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
});

test("removeMany deletes by canonical url", () => {
  const { candidates } = addManual({}, { url: "https://x.com/p", title: "" });
  assert.deepEqual(removeMany(candidates, ["https://x.com/p#frag"]), {});
});

test("lastPostedAtByRoot only looks at posted candidates", () => {
  const posted = { url: "https://x.com/a", root: "x.com", status: CANDIDATE_STATUS.POSTED, updatedAt: 500 };
  const failed = { url: "https://x.com/b", root: "x.com", status: CANDIDATE_STATUS.FAILED, updatedAt: 900 };
  assert.equal(lastPostedAtByRoot({ a: posted, b: failed }, "x.com"), 500);
  assert.equal(lastPostedAtByRoot({ a: posted }, "other.com"), 0);
});
