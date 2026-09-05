// 候选库的纯粹业务逻辑：把 API 返回的 topBacklinks 变成候选记录。
// 变换函数全部无副作用，持久化交给 store.update。

import { CANDIDATE_STATUS, LIMITS } from "../shared/constants.js";
import { canonicalUrl, rootDomain } from "../shared/util.js";

function toCandidate(backlink, sourceDomain) {
  const url = canonicalUrl(backlink.urlFrom);
  if (!url) return null;
  return {
    url,
    urlTo: canonicalUrl(backlink.urlTo),
    root: rootDomain(url),
    anchor: String(backlink.anchor || ""),
    domainRating: typeof backlink.domainRating === "number" ? backlink.domainRating : null,
    inRendered: !!backlink.inRendered,
    title: String(backlink.title || ""),
    discoveredFrom: sourceDomain,
    status: CANDIDATE_STATUS.NEW,
    note: "",
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function countByRoot(candidates) {
  return Object.values(candidates).reduce((acc, c) => {
    acc[c.root] = (acc[c.root] || 0) + 1;
    return acc;
  }, {});
}

/**
 * 合并一批 backlink 到候选库。
 * @returns {{candidates: object, added: number, skipped: object}}
 */
export function mergeBacklinks(candidates, backlinks, sourceDomain, settings) {
  const rootCount = countByRoot(candidates);
  const next = { ...candidates };
  const skipped = { duplicate: 0, rootLimit: 0, lowDr: 0, nofollow: 0, invalid: 0, capacity: 0 };
  let added = 0;

  for (const raw of backlinks) {
    if (Object.keys(next).length >= LIMITS.CANDIDATES) {
      skipped.capacity += 1;
      continue;
    }
    const candidate = toCandidate(raw, sourceDomain);
    if (!candidate) {
      skipped.invalid += 1;
      continue;
    }
    if (next[candidate.url]) {
      skipped.duplicate += 1;
      continue;
    }
    if (settings.dofollowOnly && !candidate.inRendered) {
      skipped.nofollow += 1;
      continue;
    }
    if (settings.minDomainRating > 0 && (candidate.domainRating ?? 0) < settings.minDomainRating) {
      skipped.lowDr += 1;
      continue;
    }
    if ((rootCount[candidate.root] || 0) >= settings.perRootLimit) {
      skipped.rootLimit += 1;
      continue;
    }
    next[candidate.url] = candidate;
    rootCount[candidate.root] = (rootCount[candidate.root] || 0) + 1;
    added += 1;
  }

  return { candidates: next, added, skipped };
}

export function addManual(candidates, { url, title }) {
  const clean = canonicalUrl(url);
  if (!clean || candidates[clean]) return { candidates, added: 0 };
  const entry = {
    url: clean,
    urlTo: "",
    root: rootDomain(clean),
    anchor: "",
    domainRating: null,
    inRendered: false,
    title: String(title || ""),
    discoveredFrom: "manual",
    status: CANDIDATE_STATUS.NEW,
    note: "",
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { candidates: { ...candidates, [clean]: entry }, added: 1 };
}

export function setStatus(candidates, url, status, note = "") {
  const key = canonicalUrl(url) || url;
  const existing = candidates[key];
  if (!existing) return candidates;
  return {
    ...candidates,
    [key]: { ...existing, status, note: note || existing.note, updatedAt: Date.now() },
  };
}

export function removeMany(candidates, urls) {
  const drop = new Set(urls.map((u) => canonicalUrl(u) || u));
  return Object.fromEntries(Object.entries(candidates).filter(([k]) => !drop.has(k)));
}

/** 最近在同一根域名发布过吗？用于发布节流。 */
export function lastPostedAtByRoot(candidates, root) {
  return Object.values(candidates)
    .filter((c) => c.root === root && c.status === CANDIDATE_STATUS.POSTED)
    .reduce((max, c) => Math.max(max, c.updatedAt || 0), 0);
}
