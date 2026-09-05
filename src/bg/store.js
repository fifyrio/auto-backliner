// 唯一的持久化入口。
// v1 的问题：content script、options 页、background 三处并发 read-modify-write
// chrome.storage.local.candidates，后写的会整块覆盖先写的。这里用一条串行队列
// 把所有写操作排队，并只暴露「取快照 / 用纯函数变换」两种 API。

import { DEFAULT_SETTINGS, LIMITS } from "../shared/constants.js";

const LOCAL_SHAPE = Object.freeze({
  candidates: {}, // canonicalUrl -> candidate
  tasks: [],
  logs: [],
  library: { identities: [], templates: [], siteRules: [] },
});

let queue = Promise.resolve();
const listeners = new Set();

/** 所有写操作在此串行，杜绝读改写竞态。 */
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

export async function getLocal() {
  const raw = await chrome.storage.local.get(Object.keys(LOCAL_SHAPE));
  return {
    candidates: raw.candidates || {},
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    library: {
      identities: raw.library?.identities || [],
      templates: raw.library?.templates || [],
      siteRules: raw.library?.siteRules || [],
    },
  };
}

export async function getSettings() {
  const raw = await chrome.storage.sync.get(["settings"]);
  return { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
}

export function saveSettings(patch) {
  return enqueue(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.sync.set({ settings: next });
    notify();
    return next;
  });
}

/**
 * 用纯函数变换整块 local 状态。
 * @param {(state: object) => object} transform 必须返回新对象，不得原地修改入参。
 */
export function update(transform) {
  return enqueue(async () => {
    const before = await getLocal();
    const after = transform(before);
    if (!after || after === before) return before;
    const capped = { ...after, logs: after.logs.slice(-LIMITS.LOG_ENTRIES) };
    await chrome.storage.local.set(capped);
    notify();
    return capped;
  });
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* 单个订阅者出错不应阻断其它订阅者 */
    }
  });
}

export async function clearAll() {
  await enqueue(async () => {
    await chrome.storage.local.set({ ...LOCAL_SHAPE });
    notify();
  });
}
