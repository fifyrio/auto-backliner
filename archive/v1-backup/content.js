// content.js — 在任意页面上：识别评论表单 / 验证码，注入悬浮面板，拟真填充。
// 仅在检测到疑似评论表单时才显示面板，避免打扰。

(() => {
  if (window.__blf_injected) return;
  window.__blf_injected = true;

  // ---------- 表单探测 ----------
  // 常见评论字段的候选选择器（WordPress 及通用博客）
  const SELECTORS = {
    comment: [
      "#comment", "textarea#comment", "textarea[name=comment]",
      "textarea[name=comment_content]", "textarea[name=message]",
      "textarea[name=body]", "textarea[name=text]", "form#commentform textarea",
      "textarea[id*=comment i]", "textarea[name*=comment i]", "textarea",
    ],
    author: [
      "#author", "input[name=author]", "input[name=name]",
      "input[name=comment_author]", "input[id*=author i]",
      "input[name*=name i]", "input[autocomplete=name]",
    ],
    email: [
      "#email", "input[type=email]", "input[name=email]",
      "input[name=comment_author_email]", "input[id*=email i]", "input[name*=email i]",
    ],
    url: [
      "#url", "input[name=url]", "input[name=website]",
      "input[name=comment_author_url]", "input[id*=url i]",
      "input[id*=website i]", "input[name*=website i]", "input[type=url]",
    ],
  };

  function findFirst(list) {
    for (const sel of list) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const n of nodes) {
          if (n.offsetParent !== null || n.getClientRects().length) return n; // 可见
        }
      } catch (e) { /* 忽略无效选择器 */ }
    }
    return null;
  }

  function detectFields() {
    return {
      comment: findFirst(SELECTORS.comment),
      author: findFirst(SELECTORS.author),
      email: findFirst(SELECTORS.email),
      url: findFirst(SELECTORS.url),
    };
  }

  function detectCaptcha() {
    const hints = [];
    if (document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey]')) hints.push("reCAPTCHA");
    if (document.querySelector('iframe[src*="hcaptcha"], .h-captcha')) hints.push("hCaptcha");
    if (document.querySelector('iframe[src*="turnstile"], .cf-turnstile')) hints.push("Turnstile");
    if (/just a moment|attention required/i.test(document.title)) hints.push("Cloudflare");
    return hints;
  }

  // ---------- 拟真输入 ----------
  // 用原生 setter 触发 React/Vue 的 onChange，逐字符输入并带随机延迟
  function nativeSetValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function typeHumanLike(el, text) {
    if (!el || text == null) return;
    el.focus();
    el.dispatchEvent(new Event("focus", { bubbles: true }));
    nativeSetValue(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    let cur = "";
    for (const ch of String(text)) {
      cur += ch;
      nativeSetValue(el, cur);
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: ch }));
      await sleep(rand(35, 110)); // 逐字符延迟
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function buildComment(tpl, site, anchor) {
    let body = (tpl || "").replace(/\{site\}/g, site || "").replace(/\{anchor\}/g, anchor || "");
    if (!/\{site\}|https?:\/\//i.test(tpl || "") && site) {
      // 模板没放链接时，正文追加一个带链接（含锚文本）
      body += ` ${anchor ? anchor + ": " : ""}${site}`;
    }
    return body.trim();
  }

  async function fillForm(profile, { autoScroll = true } = {}) {
    const f = detectFields();
    if (!f.comment) { toast("未找到评论正文框", true); return; }

    if (autoScroll) {
      f.comment.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(rand(600, 1200)); // 模拟“阅读”停顿
    }
    if (f.author && profile.pName) await typeHumanLike(f.author, profile.pName);
    if (f.email && profile.pEmail) await typeHumanLike(f.email, profile.pEmail);
    if (f.url && profile.pSite) await typeHumanLike(f.url, profile.pSite);
    const commentText = buildComment(profile.pComment, profile.pSite, profile.pAnchor);
    await typeHumanLike(f.comment, commentText);
    toast("已填充，请你自行检查后点击提交按钮");
  }

  // ---------- 悬浮面板 ----------
  let panel;
  function toast(msg, isErr) {
    const t = panel && panel.querySelector(".blf-toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "blf-toast" + (isErr ? " err" : " ok");
    setTimeout(() => { t.textContent = ""; t.className = "blf-toast"; }, 4000);
  }

  function classify(fields, captcha) {
    if (captcha.length) return { key: "captcha", label: "有验证码：" + captcha.join(", ") };
    if (fields.comment) return { key: "has_form", label: "检测到评论表单" };
    return { key: "no_form", label: "未检测到评论表单" };
  }

  async function reportStatus(statusKey) {
    // 把当前页 URL 的状态同步回候选库（若它是候选之一）
    try {
      const store = await chrome.storage.local.get(["candidates"]);
      const candidates = store.candidates || {};
      const here = location.href;
      // 精确或去掉 hash 匹配
      const keys = Object.keys(candidates);
      const match = keys.find((k) => k === here || k.split("#")[0] === here.split("#")[0]);
      if (match) {
        candidates[match].status = statusKey;
        await chrome.storage.local.set({ candidates });
      }
    } catch (e) { /* 忽略 */ }
  }

  function buildPanel(cls, fields, captcha) {
    panel = document.createElement("div");
    panel.className = "blf-panel";
    panel.innerHTML = `
      <div class="blf-head">
        <span>🔗 外链机会助手</span>
        <button class="blf-x" title="收起">×</button>
      </div>
      <div class="blf-status blf-${cls.key}">${cls.label}</div>
      <div class="blf-fields">
        ${fieldRow("正文", fields.comment)}
        ${fieldRow("姓名", fields.author)}
        ${fieldRow("邮箱", fields.email)}
        ${fieldRow("网站", fields.url)}
      </div>
      <div class="blf-actions">
        <button class="blf-fill blf-primary" ${fields.comment ? "" : "disabled"}>拟真填充</button>
        <button class="blf-mark-post">标记已发</button>
        <button class="blf-mark-skip">跳过</button>
      </div>
      <div class="blf-toast"></div>
      <div class="blf-note">提交按钮请你手动点击。填充为逐字符拟真输入。</div>
    `;
    document.documentElement.appendChild(panel);

    panel.querySelector(".blf-x").addEventListener("click", () => panel.remove());
    panel.querySelector(".blf-fill").addEventListener("click", async () => {
      const profile = await chrome.storage.sync.get(["pName", "pEmail", "pSite", "pAnchor", "pComment"]);
      if (!profile.pSite) { toast("请先在设置页填写你的网站 URL", true); return; }
      await fillForm(profile);
    });
    panel.querySelector(".blf-mark-post").addEventListener("click", () => { reportStatus("posted"); toast("已标记为已发布"); });
    panel.querySelector(".blf-mark-skip").addEventListener("click", () => { reportStatus("skipped"); toast("已标记为跳过"); });
  }

  function fieldRow(label, el) {
    const ok = !!el;
    return `<div class="blf-row"><span>${label}</span><b class="${ok ? "y" : "n"}">${ok ? "✓" : "—"}</b></div>`;
  }

  // ---------- 启动 ----------
  function run() {
    const fields = detectFields();
    const captcha = detectCaptcha();
    // 只有当存在评论正文框或验证码时才提示，避免在无关页面弹出
    if (!fields.comment && !captcha.length) return;
    const cls = classify(fields, captcha);
    reportStatus(cls.key);
    buildPanel(cls, fields, captcha);
  }

  // 允许 popup 主动触发填充
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === "getPageClassification") {
      const fields = detectFields();
      const captcha = detectCaptcha();
      sendResponse(classify(fields, captcha));
      return;
    }
    if (msg && msg.type === "fillNow") {
      (async () => {
        const profile = await chrome.storage.sync.get(["pName", "pEmail", "pSite", "pAnchor", "pComment"]);
        await fillForm(profile);
        sendResponse({ ok: true });
      })();
      return true;
    }
  });

  // 页面可能是 SPA / 评论区延迟加载，稍等再探测一次
  if (document.readyState === "complete") setTimeout(run, 800);
  else window.addEventListener("load", () => setTimeout(run, 800));
})();
