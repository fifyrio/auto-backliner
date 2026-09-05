// v1 → v2 数据迁移。
// v1 的候选记录以 urlFrom 为键、字段名也叫 urlFrom；v2 统一成规范化后的 url。
// 老用户升级后不该丢掉已经标记过「已发布」的记录。

import { CANDIDATE_STATUS } from "../shared/constants.js";
import { canonicalUrl, rootDomain } from "../shared/util.js";
import { update } from "./store.js";

const V1_STATUS_MAP = {
  new: CANDIDATE_STATUS.NEW,
  opened: CANDIDATE_STATUS.OPENED,
  has_form: CANDIDATE_STATUS.HAS_FORM,
  no_form: CANDIDATE_STATUS.NO_FORM,
  captcha: CANDIDATE_STATUS.CAPTCHA,
  posted: CANDIDATE_STATUS.POSTED,
  skipped: CANDIDATE_STATUS.SKIPPED,
};

function isLegacy(entry) {
  return entry && typeof entry.urlFrom === "string" && entry.url === undefined;
}

function convert(entry) {
  const url = canonicalUrl(entry.urlFrom);
  if (!url) return null;
  return {
    url,
    urlTo: canonicalUrl(entry.urlTo),
    root: entry.sourceRoot || rootDomain(url),
    anchor: entry.anchor || "",
    domainRating: typeof entry.domainRating === "number" ? entry.domainRating : null,
    inRendered: !!entry.inRendered,
    title: entry.title || "",
    discoveredFrom: entry.discoveredFrom || "",
    status: V1_STATUS_MAP[entry.status] || CANDIDATE_STATUS.NEW,
    note: "",
    addedAt: entry.addedAt || Date.now(),
    updatedAt: Date.now(),
  };
}

/** v1 把身份和模板存在 storage.sync 的散字段里，搬进资源库。 */
async function migrateProfile(library) {
  const old = await chrome.storage.sync.get(["pName", "pEmail", "pSite", "pAnchor", "pComment"]);
  if (!old.pSite && !old.pComment) return library;
  const next = { ...library, identities: [...library.identities], templates: [...library.templates] };
  if (old.pSite && !next.identities.length) {
    next.identities.push({
      id: "identity_migrated",
      name: old.pName || "",
      email: old.pEmail || "",
      site: old.pSite,
      anchor: old.pAnchor || "",
      updatedAt: Date.now(),
    });
  }
  if (old.pComment && !next.templates.length) {
    next.templates.push({ id: "template_migrated", name: "v1 模板", body: old.pComment, updatedAt: Date.now() });
  }
  await chrome.storage.sync.remove(["pName", "pEmail", "pSite", "pAnchor", "pComment"]);
  return next;
}

export async function migrate() {
  const legacyProfile = await chrome.storage.sync.get(["apiKey"]);
  if (legacyProfile.apiKey) {
    const { settings = {} } = await chrome.storage.sync.get(["settings"]);
    if (!settings.apiKey) await chrome.storage.sync.set({ settings: { ...settings, apiKey: legacyProfile.apiKey } });
    await chrome.storage.sync.remove(["apiKey"]);
  }

  await update((state) => {
    const entries = Object.values(state.candidates);
    if (!entries.some(isLegacy)) return state;
    const candidates = {};
    for (const entry of entries) {
      const next = isLegacy(entry) ? convert(entry) : entry;
      if (next) candidates[next.url] = next;
    }
    return { ...state, candidates };
  });

  const { library = { identities: [], templates: [], siteRules: [] } } = await chrome.storage.local.get(["library"]);
  const migratedLibrary = await migrateProfile(library);
  if (migratedLibrary !== library) {
    await update((state) => ({ ...state, library: migratedLibrary }));
  }
}
