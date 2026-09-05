// options.js — 设置 + 发现仪表盘

const $ = (id) => document.getElementById(id);

const STATUS_LABEL = {
  new: "未处理",
  opened: "已打开",
  has_form: "有表单",
  no_form: "无表单",
  captcha: "有验证码",
  posted: "已发布",
  skipped: "已跳过",
};

// ---------- 设置读写 ----------
async function loadConfig() {
  const cfg = await chrome.storage.sync.get([
    "apiKey", "pName", "pEmail", "pSite", "pAnchor", "pComment",
  ]);
  $("apiKey").value = cfg.apiKey || "";
  $("pName").value = cfg.pName || "";
  $("pEmail").value = cfg.pEmail || "";
  $("pSite").value = cfg.pSite || "";
  $("pAnchor").value = cfg.pAnchor || "";
  $("pComment").value = cfg.pComment ||
    "Great write-up! I built something related at {site} — the {anchor} approach really helped.";
}

async function saveConfig() {
  await chrome.storage.sync.set({
    apiKey: $("apiKey").value.trim(),
    pName: $("pName").value.trim(),
    pEmail: $("pEmail").value.trim(),
    pSite: $("pSite").value.trim(),
    pAnchor: $("pAnchor").value.trim(),
    pComment: $("pComment").value,
  });
  const m = $("saveMsg");
  m.textContent = "✓ 已保存";
  setTimeout(() => (m.textContent = ""), 1800);
}

// ---------- 发现 ----------
function log(html, cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  el.innerHTML = html;
  $("discoverLog").appendChild(el);
}

async function discover() {
  $("discoverLog").innerHTML = "";
  const domains = $("domains").value
    .split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!domains.length) { log("请先填写至少一个域名。", "err"); return; }

  const btn = $("discover");
  btn.disabled = true; btn.textContent = "查询中…";
  for (const d of domains) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "queryBacklinks", domain: d });
      if (!res || !res.ok) { log(`✗ ${d}：${(res && res.error) || "失败"}`, "err"); continue; }
      const s = res.summary || {};
      log(
        `✓ <b>${d}</b> — DR ${s.domainRating ?? "?"} · 外链 ${s.backlinks ?? "?"} · ` +
        `引用域名 ${s.refdomains ?? "?"} · 拉取 ${res.count} 条，新增候选 ${res.merged.added} ` +
        `（库共 ${res.merged.total}）· 剩余积分 ${s.remainingCredits ?? "?"}`,
        "ok"
      );
      if (typeof s.remainingCredits === "number") {
        $("credits").textContent = `剩余积分：${s.remainingCredits}`;
      }
    } catch (e) {
      log(`✗ ${d}：${e.message || e}`, "err");
    }
  }
  btn.disabled = false; btn.textContent = "🔍 发现外链机会";
  renderTable();
}

// ---------- 候选表 ----------
async function getCandidates() {
  const store = await chrome.storage.local.get(["candidates"]);
  return store.candidates || {};
}

function domainCell(url, root) {
  return `<span class="src"><a href="${url}" target="_blank" title="${url}">${root}</a></span>`;
}

async function renderTable() {
  const candidates = await getCandidates();
  const arr = Object.values(candidates).sort((a, b) => (b.domainRating || 0) - (a.domainRating || 0));

  const fStatus = $("filterStatus").value;
  const onlyDo = $("onlyDofollow").checked;
  const q = $("search").value.trim().toLowerCase();

  const filtered = arr.filter((c) => {
    if (fStatus !== "all" && c.status !== fStatus) return false;
    if (onlyDo && !c.inRendered) return false;
    if (q && !(`${c.sourceRoot} ${c.title}`.toLowerCase().includes(q))) return false;
    return true;
  });

  $("countBadge").textContent = arr.length;
  const body = $("candBody");
  body.innerHTML = "";
  $("emptyMsg").style.display = filtered.length ? "none" : "block";

  for (const c of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${domainCell(c.urlFrom, c.sourceRoot)}</td>
      <td class="dr">${c.domainRating ?? "—"}</td>
      <td>${c.inRendered ? '<span class="yes">✓</span>' : '<span class="no">—</span>'}</td>
      <td>${escapeHtml(c.anchor || "—")}</td>
      <td title="${escapeHtml(c.title)}">${escapeHtml(truncate(c.title, 40) || "—")}</td>
      <td>${escapeHtml(c.discoveredFrom || "—")}</td>
      <td><span class="tag ${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
      <td class="acts">
        <button data-act="open" data-url="${c.urlFrom}" class="ghost">打开</button>
        <button data-act="posted" data-url="${c.urlFrom}" class="ghost">已发</button>
        <button data-act="skipped" data-url="${c.urlFrom}" class="ghost">跳过</button>
      </td>`;
    body.appendChild(tr);
  }
}

async function setStatus(url, status) {
  await chrome.runtime.sendMessage({ type: "setCandidateStatus", urlFrom: url, status });
  renderTable();
}

function onTableClick(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const url = btn.dataset.url;
  const act = btn.dataset.act;
  if (act === "open") {
    chrome.tabs.create({ url });
    setStatus(url, "opened");
  } else if (act === "posted") {
    setStatus(url, "posted");
  } else if (act === "skipped") {
    setStatus(url, "skipped");
  }
}

async function exportCsv() {
  const candidates = await getCandidates();
  const arr = Object.values(candidates);
  const head = ["sourceRoot", "domainRating", "inRendered", "anchor", "title", "urlFrom", "urlTo", "discoveredFrom", "status"];
  const rows = [head.join(",")];
  for (const c of arr) {
    rows.push(head.map((k) => csvCell(c[k])).join(","));
  }
  const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backlink-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAll() {
  if (!confirm("确定清空所有候选页面？此操作不可撤销。")) return;
  await chrome.storage.local.set({ candidates: {} });
  renderTable();
}

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function truncate(s, n) { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; }
function csvCell(v) {
  const s = String(v == null ? "" : v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

// ---------- 绑定 ----------
document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  renderTable();

  $("saveCfg").addEventListener("click", saveConfig);
  $("discover").addEventListener("click", discover);
  $("candBody").addEventListener("click", onTableClick);
  $("filterStatus").addEventListener("change", renderTable);
  $("onlyDofollow").addEventListener("change", renderTable);
  $("search").addEventListener("input", renderTable);
  $("exportCsv").addEventListener("click", exportCsv);
  $("clearAll").addEventListener("click", clearAll);
  $("toggleKey").addEventListener("click", () => {
    const el = $("apiKey");
    el.type = el.type === "password" ? "text" : "password";
  });
});
