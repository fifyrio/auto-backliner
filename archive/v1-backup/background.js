// background.js — MV3 service worker
// 负责调用 GoAnyAPI Backlinks API（在后台调用可绕过页面 CORS 限制），
// 并把候选外链去重后写入 chrome.storage.local。

const API_ENDPOINT = "https://api.goanyapi.com/api/v1/backlink";

// 取根域名，用于去重（同一根域名下只保留有限条）
function rootDomain(urlOrHost) {
  try {
    let host = urlOrHost;
    if (/^https?:\/\//i.test(urlOrHost)) host = new URL(urlOrHost).hostname;
    host = host.replace(/^www\./i, "").toLowerCase();
    return host;
  } catch (e) {
    return String(urlOrHost || "").toLowerCase();
  }
}

// 调 Backlinks API
async function queryBacklinks(domain, apiKey) {
  if (!apiKey) throw new Error("未配置 API Key，请先在设置页填写。");
  const clean = String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!clean) throw new Error("域名为空。");

  const url = `${API_ENDPOINT}?domain=${encodeURIComponent(clean)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  let json;
  try {
    json = await resp.json();
  } catch (e) {
    throw new Error(`API 返回非 JSON（HTTP ${resp.status}）`);
  }

  if (!resp.ok) {
    throw new Error(json && json.message ? json.message : `HTTP ${resp.status}`);
  }
  if (json.code && json.code !== "ok" && json.code !== 0) {
    throw new Error(json.message || `业务错误 code=${json.code}`);
  }
  return json.data || {};
}

// 把 topBacklinks 转成候选记录，去重合并进已有候选库
async function mergeCandidates(sourceDomain, data) {
  const store = await chrome.storage.local.get(["candidates"]);
  const candidates = store.candidates || {}; // key = 候选来源页 urlFrom

  const perRootLimit = 3; // 同一根域名最多保留几条
  const rootCount = {};
  Object.values(candidates).forEach((c) => {
    const r = rootDomain(c.urlFrom);
    rootCount[r] = (rootCount[r] || 0) + 1;
  });

  const list = Array.isArray(data.topBacklinks) ? data.topBacklinks : [];
  let added = 0;
  for (const b of list) {
    const key = b.urlFrom;
    if (!key) continue;
    if (candidates[key]) continue; // 已存在

    const r = rootDomain(b.urlFrom);
    if ((rootCount[r] || 0) >= perRootLimit) continue; // 根域名超限

    candidates[key] = {
      urlFrom: b.urlFrom,
      urlTo: b.urlTo || "",
      sourceRoot: r,
      anchor: b.anchor || "",
      domainRating: typeof b.domainRating === "number" ? b.domainRating : null,
      inRendered: !!b.inRendered,
      inRaw: !!b.inRaw,
      title: b.title || "",
      textPre: b.textPre || "",
      textPost: b.textPost || "",
      discoveredFrom: sourceDomain, // 从哪个竞品域名挖到的
      status: "new", // new | opened | has_form | no_form | captcha | posted | skipped
      addedAt: Date.now(),
    };
    rootCount[r] = (rootCount[r] || 0) + 1;
    added += 1;
  }

  await chrome.storage.local.set({ candidates });
  return { added, total: Object.keys(candidates).length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg && msg.type === "queryBacklinks") {
        const cfg = await chrome.storage.sync.get(["apiKey"]);
        const data = await queryBacklinks(msg.domain, cfg.apiKey);
        const merged = await mergeCandidates(
          String(msg.domain).trim(),
          data
        );
        sendResponse({
          ok: true,
          summary: {
            domain: data.domain,
            backlinks: data.backlinks,
            dofollowBacklinks: data.dofollowBacklinks,
            dofollowRefdomains: data.dofollowRefdomains,
            domainRating: data.domainRating,
            refdomains: data.refdomains,
            costCredits: data.costCredits,
            remainingCredits: data.remainingCredits,
          },
          count: Array.isArray(data.topBacklinks) ? data.topBacklinks.length : 0,
          merged,
        });
      } else if (msg && msg.type === "setCandidateStatus") {
        const store = await chrome.storage.local.get(["candidates"]);
        const candidates = store.candidates || {};
        if (candidates[msg.urlFrom]) {
          candidates[msg.urlFrom].status = msg.status;
          await chrome.storage.local.set({ candidates });
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "未知消息类型" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // async
});
