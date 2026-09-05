// 标签页与脚本注入的薄封装。
// v1 用 content_scripts 静态匹配 http(s)://*/*，等于在你浏览的每一个页面都注入代码。
// 这里改成按需注入：只有任务真正打开的那个标签页才会被注入。

import { LIMITS } from "../shared/constants.js";
import { sleep } from "../shared/util.js";

const CONTENT_FILES = [
  "src/content/detect.js",
  "src/content/fill.js",
  "src/content/agent.js",
];

export async function hasHostAccess() {
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}

export function openTab(url, { active = false } = {}) {
  return chrome.tabs.create({ url, active });
}

/** 等待标签页加载完成；超时返回 false 而不是永久挂起。 */
export function waitForLoad(tabId, timeoutMs = LIMITS.PAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
      resolve(ok);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    const onRemoved = (id) => id === tabId && finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then(
      (tab) => tab.status === "complete" && finish(true),
      () => finish(false)
    );
  });
}

export async function injectAgent(tabId) {
  // 注入到所有帧：博客评论表单常常在跨域 iframe 里（Jetpack / WordPress.com、
  // Disqus 之外的托管评论等），只注入顶层帧会看不到 textarea。
  // 部分帧（about:blank、被 CSP 挡住的第三方帧）可能注入失败，忽略即可。
  await chrome.scripting
    .insertCSS({ target: { tabId, allFrames: true }, files: ["src/content/agent.css"] })
    .catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
}

/** 给某个标签页（可指定帧）发消息；失败返回 null 而不是抛未捕获异常。 */
export async function ask(tabId, message, frameId) {
  try {
    const options = typeof frameId === "number" ? { frameId } : undefined;
    return await chrome.tabs.sendMessage(tabId, message, options);
  } catch {
    return null;
  }
}

async function listFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames || []).map((f) => f.frameId);
  } catch {
    return [0]; // 没有 webNavigation 权限时退回只看顶层帧
  }
}

/**
 * 逐帧探测，挑出真正含评论表单的那一帧。
 * 表单可能延迟渲染，探测失败时重试几次再放弃。
 * @returns {Promise<{frameId:number,classification:string,captcha:string[],embedded:string[]}|null>}
 */
export async function locateFormFrame(tabId, rules, { attempts = 4, gapMs = 900 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const frameIds = await listFrames(tabId);
    const results = await Promise.all(
      frameIds.map(async (frameId) => {
        const res = await ask(tabId, { type: "blf:detect", rules }, frameId);
        return res ? { frameId, ...res } : null;
      })
    );
    const found = results.filter(Boolean);
    const withForm = found.find((r) => r.classification === "has_form");
    if (withForm) return withForm;
    // 最后一次尝试才回退到验证码 / 第三方系统 / 顶层帧的结论
    if (i === attempts - 1) {
      return (
        found.find((r) => r.classification === "captcha") ||
        found.find((r) => r.classification === "embedded") ||
        found.find((r) => r.frameId === 0) ||
        found[0] ||
        null
      );
    }
    await sleep(gapMs);
  }
  return null;
}

export async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* 用户可能已经手动关掉了 */
  }
}
