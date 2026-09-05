// MV3 service worker 入口：只做消息路由，业务逻辑在 src/bg/* 里。

import { MSG, TASK_STATUS } from "./src/shared/constants.js";
import { canonicalUrl, cleanDomain, uid } from "./src/shared/util.js";
import { queryBacklinks } from "./src/bg/api.js";
import * as store from "./src/bg/store.js";
import * as log from "./src/bg/logger.js";
import * as runner from "./src/bg/runner.js";
import { addManual, mergeBacklinks, removeMany, setStatus } from "./src/bg/candidates.js";
import { createTask, patchTask, taskStats } from "./src/bg/tasks.js";
import { migrate } from "./src/bg/migrate.js";

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await migrate().catch((e) => log.error(`数据迁移失败：${e.message || e}`));
});

// 状态变更后广播给侧栏，面板不用轮询。
store.onChange(() => {
  chrome.runtime.sendMessage({ type: MSG.STATE_CHANGED }).catch(() => {});
});

async function snapshot() {
  const [state, settings] = await Promise.all([store.getLocal(), store.getSettings()]);
  return {
    ...state,
    settings,
    tasks: state.tasks.map((t) => ({ ...t, computed: taskStats(t) })),
    running: { taskId: runner.runningTaskId() },
  };
}

async function discover(domain) {
  const settings = await store.getSettings();
  const data = await queryBacklinks(domain, settings.apiKey);
  const list = Array.isArray(data.topBacklinks) ? data.topBacklinks : [];
  let result;
  await store.update((state) => {
    result = mergeBacklinks(state.candidates, list, cleanDomain(domain), settings);
    return { ...state, candidates: result.candidates };
  });
  await log.info(
    `发现 ${cleanDomain(domain)}：拉取 ${list.length} 条，新增 ${result.added} 条`,
    { domain: cleanDomain(domain) }
  );
  return {
    fetched: list.length,
    added: result.added,
    skipped: result.skipped,
    summary: {
      domain: data.domain,
      backlinks: data.backlinks,
      refdomains: data.refdomains,
      domainRating: data.domainRating,
      costCredits: data.costCredits,
      remainingCredits: data.remainingCredits,
    },
  };
}

const HANDLERS = {
  [MSG.GET_SNAPSHOT]: () => snapshot(),

  [MSG.DISCOVER]: ({ domain }) => discover(domain),

  [MSG.ADD_CURRENT_PAGE]: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !canonicalUrl(tab.url)) throw new Error("当前标签页不是普通网页");
    let added = 0;
    await store.update((state) => {
      const res = addManual(state.candidates, { url: tab.url, title: tab.title });
      added = res.added;
      return { ...state, candidates: res.candidates };
    });
    return { added };
  },

  [MSG.SET_CANDIDATE_STATUS]: async ({ url, status }) => {
    await store.update((s) => ({ ...s, candidates: setStatus(s.candidates, url, status) }));
    return { ok: true };
  },

  [MSG.DELETE_CANDIDATES]: async ({ urls }) => {
    await store.update((s) => ({ ...s, candidates: removeMany(s.candidates, urls) }));
    return { ok: true };
  },

  [MSG.TASK_CREATE]: async (payload) => {
    const task = createTask(payload);
    if (!task.urls.length) throw new Error("任务里没有可用的候选页面");
    await store.update((s) => ({ ...s, tasks: [task, ...s.tasks] }));
    await log.info(`新建任务：${task.name}（${task.urls.length} 条）`, { taskId: task.id });
    return { id: task.id };
  },

  [MSG.TASK_UPDATE]: async ({ taskId, patch }) => {
    await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, patch) }));
    return { ok: true };
  },

  [MSG.TASK_DELETE]: async ({ taskId }) => {
    if (runner.runningTaskId() === taskId) await runner.stop(taskId);
    await store.update((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
    return { ok: true };
  },

  [MSG.TASK_START]: async ({ taskId }) => {
    await runner.start(taskId);
    return { ok: true };
  },

  [MSG.TASK_PAUSE]: async ({ taskId }) => {
    await runner.pause(taskId);
    return { ok: true };
  },

  [MSG.TASK_STOP]: async ({ taskId }) => {
    await runner.stop(taskId);
    return { ok: true };
  },

  [MSG.RUN_DECISION]: ({ decision }) => ({ accepted: runner.decide(decision) }),

  [MSG.FILL_CURRENT_PAGE]: (payload) => runner.fillActivePage(payload),

  [MSG.SAVE_SETTINGS]: ({ patch }) => store.saveSettings(patch),

  [MSG.LIBRARY_SAVE]: async ({ kind, item }) => {
    const entry = { ...item, id: item.id || uid(kind), updatedAt: Date.now() };
    await store.update((s) => {
      const list = s.library[kind] || [];
      const exists = list.some((x) => x.id === entry.id);
      return {
        ...s,
        library: {
          ...s.library,
          [kind]: exists ? list.map((x) => (x.id === entry.id ? entry : x)) : [...list, entry],
        },
      };
    });
    return { id: entry.id };
  },

  [MSG.LIBRARY_DELETE]: async ({ kind, id }) => {
    await store.update((s) => ({
      ...s,
      library: { ...s.library, [kind]: (s.library[kind] || []).filter((x) => x.id !== id) },
    }));
    return { ok: true };
  },

  [MSG.CLEAR_LOGS]: async () => {
    await log.clearLogs();
    return { ok: true };
  },

  [MSG.CLEAR_DATA]: async () => {
    const active = runner.runningTaskId();
    if (active) await runner.stop(active);
    await store.clearAll();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true; // 异步响应
});

// service worker 被回收再唤醒时，把「运行中」的任务归位成暂停，避免状态说谎。
chrome.runtime.onStartup.addListener(async () => {
  await store.update((s) => ({
    ...s,
    tasks: s.tasks.map((t) =>
      t.status === TASK_STATUS.RUNNING ? { ...t, status: TASK_STATUS.PAUSED, current: null } : t
    ),
  }));
});
