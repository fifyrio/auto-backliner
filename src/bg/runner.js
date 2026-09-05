// 发布引擎：一次只跑一个任务、一个标签页，串行推进。
// 设计要点
//  - assist 模式（默认）：填好表单就停下，等你在侧栏点「已提交 / 跳过 / 失败」再继续。
//  - auto 模式：内容脚本代点提交，并回读页面反馈判断成功 / 待审核 / 失败。
//  - 每条之间随机间隔 + 同根域名冷却，避免固定节奏被判为 spam。
//  - cursor 落盘，service worker 被回收后可以从断点续跑。

import { CANDIDATE_STATUS, LIMITS, SUBMIT_MODE, TASK_STATUS } from "../shared/constants.js";
import { randInt, renderTemplate, rootDomain } from "../shared/util.js";
import * as log from "./logger.js";
import * as store from "./store.js";
import * as tabsApi from "./tabs.js";
import { bumpStat, findTask, isFinished, patchTask } from "./tasks.js";
import { lastPostedAtByRoot, setStatus } from "./candidates.js";

const run = {
  taskId: null,
  tabId: null,
  abort: null, // () => void，用于打断等待
  decide: null, // (decision) => void，assist 模式的人工裁决回调
  keepalive: null,
};

export const isRunning = () => run.taskId !== null;
export const runningTaskId = () => run.taskId;

/** 可被 pause/stop 立即打断的等待。 */
function interruptibleWait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("done"), ms);
    run.abort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
  });
}

function waitForDecision() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ result: "failed", reason: "timeout" }), LIMITS.FILL_TIMEOUT_MS * 4);
    run.decide = (decision) => {
      clearTimeout(timer);
      resolve(decision);
    };
    run.abort = () => {
      clearTimeout(timer);
      resolve({ result: "aborted" });
    };
  });
}

/** MV3 心跳：运行期间定期触碰扩展 API，避免 service worker 被回收。 */
function startKeepalive() {
  stopKeepalive();
  run.keepalive = setInterval(() => chrome.runtime.getPlatformInfo(), LIMITS.KEEPALIVE_INTERVAL_MS);
}

function stopKeepalive() {
  if (run.keepalive) clearInterval(run.keepalive);
  run.keepalive = null;
}

async function buildPayload(task, state, settings) {
  const identity = state.library.identities.find((i) => i.id === task.identityId);
  const template = state.library.templates.find((tm) => tm.id === task.templateId);
  if (!identity) throw new Error("任务引用的身份已被删除");
  if (!template) throw new Error("任务引用的模板已被删除");

  const site = task.targetUrl || identity.site;
  const body = renderTemplate(template.body, {
    site,
    anchor: task.anchor || identity.anchor,
    name: identity.name,
  });
  return {
    name: identity.name,
    email: identity.email,
    site,
    anchor: task.anchor || identity.anchor,
    body,
    typeSpeedMs: settings.typeSpeedMs,
    autoSubmit: settings.submitMode === SUBMIT_MODE.AUTO,
    rules: state.library.siteRules,
  };
}

/** 同根域名冷却未到就跳过本轮，把它挪到队尾以后再试。 */
function cooldownRemainingMs(state, url, settings) {
  const last = lastPostedAtByRoot(state.candidates, rootDomain(url));
  if (!last) return 0;
  const elapsed = Date.now() - last;
  const required = settings.rootCooldownMin * 60 * 1000;
  return Math.max(0, required - elapsed);
}

async function publishOne(task, url, settings) {
  const state = await store.getLocal();
  const payload = await buildPayload(task, state, settings);

  const cooling = cooldownRemainingMs(state, url, settings);
  if (cooling > 0) {
    await log.warn(`同域名冷却中，跳过：${rootDomain(url)}`, { taskId: task.id, url });
    return { result: "skipped", reason: "cooldown" };
  }

  const tab = await tabsApi.openTab(url);
  run.tabId = tab.id;
  const loaded = await tabsApi.waitForLoad(tab.id);
  if (!loaded) return { result: "failed", reason: "页面加载超时" };

  await tabsApi.injectAgent(tab.id);

  // 先逐帧找到真正含评论表单的那一帧，再在该帧里填充、提交。
  const frame = await tabsApi.locateFormFrame(tab.id, payload.rules);
  if (!frame || frame.classification !== "has_form") {
    if (frame?.captcha?.length) return { result: "failed", reason: `验证码：${frame.captcha.join(", ")}` };
    if (frame?.embedded?.length) return { result: "failed", reason: `第三方评论系统：${frame.embedded.join(", ")}` };
    return { result: "failed", reason: "未找到评论表单" };
  }
  const frameId = frame.frameId;

  const filled = await tabsApi.ask(tab.id, { type: "blf:fill", payload }, frameId);
  if (!filled || !filled.ok) {
    if (filled?.captcha?.length) return { result: "failed", reason: `验证码：${filled.captcha.join(", ")}` };
    return { result: "failed", reason: filled?.reason || "填充失败" };
  }
  if (!payload.autoSubmit) {
    await chrome.tabs.update(tab.id, { active: true }); // 交给人工，把页面切到前台
    return { result: "awaiting" };
  }
  const submitted = await tabsApi.ask(tab.id, { type: "blf:submit" }, frameId);
  if (submitted) return submitted;

  // 没拿到响应通常是提交后帧/页面跳转，内容脚本被销毁了。
  // 重新加载完成后再注入一次，只读页面文案判断结果 —— 别把成功当成失败。
  if (!(await tabsApi.waitForLoad(tab.id, 15000))) {
    return { result: "pending", reason: "提交后页面跳转，未读到回执" };
  }
  await tabsApi.injectAgent(tab.id);
  const readFrame = await tabsApi.locateFormFrame(tab.id, payload.rules, { attempts: 1 });
  const recovered = await tabsApi.ask(tab.id, { type: "blf:readPage" }, readFrame?.frameId);
  return recovered || { result: "pending", reason: "提交后页面跳转，未读到回执" };
}

const RESULT_TO_STATUS = {
  success: CANDIDATE_STATUS.POSTED,
  pending: CANDIDATE_STATUS.PENDING,
  failed: CANDIDATE_STATUS.FAILED,
  skipped: CANDIDATE_STATUS.SKIPPED,
};
const RESULT_TO_STAT = { success: "success", pending: "pending", failed: "failed", skipped: "skipped" };

async function recordResult(taskId, url, outcome) {
  const statKey = RESULT_TO_STAT[outcome.result] || "failed";
  const status = RESULT_TO_STATUS[outcome.result] || CANDIDATE_STATUS.FAILED;
  await store.update((state) => ({
    ...state,
    candidates: setStatus(state.candidates, url, status, outcome.reason || ""),
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? { ...bumpStat(t, statKey), cursor: t.cursor + 1, current: null }
        : t
    ),
  }));

  const line = `${url} → ${outcome.result}${outcome.reason ? ` (${outcome.reason})` : ""}`;
  if (outcome.result === "success") await log.success(line, { taskId, url });
  else if (outcome.result === "failed") await log.error(line, { taskId, url });
  else await log.info(line, { taskId, url });
}

async function loop(taskId) {
  const settings = await store.getSettings();

  for (;;) {
    const state = await store.getLocal();
    const task = findTask(state.tasks, taskId);
    if (!task || task.status !== TASK_STATUS.RUNNING) break;
    if (isFinished(task)) {
      await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { status: TASK_STATUS.DONE, current: null }) }));
      await log.success(`任务完成：${task.name}`, { taskId });
      break;
    }

    const url = task.urls[task.cursor];
    await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { current: { url, phase: "filling" } }) }));

    let outcome;
    try {
      outcome = await publishOne(task, url, settings);
    } catch (e) {
      outcome = { result: "failed", reason: e.message || String(e) };
    }

    if (outcome.result === "awaiting") {
      await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { current: { url, phase: "awaiting", tabId: run.tabId } }) }));
      outcome = await waitForDecision();
      if (outcome.result === "aborted") break;
    }

    if (settings.closeTabAfter && run.tabId) await tabsApi.closeTab(run.tabId);
    run.tabId = null;

    await recordResult(taskId, url, outcome);

    const gap = randInt(settings.gapMinSec, Math.max(settings.gapMinSec, settings.gapMaxSec)) * 1000;
    if ((await interruptibleWait(gap)) === "aborted") break;
  }

  stopKeepalive();
  run.taskId = null;
  run.abort = null;
  run.decide = null;
}

/**
 * 手动填充当前活动标签页的评论表单（对应侧栏「拟真填充当前页」）。
 * 不进任务队列，只填不提交，交给你人工检查后自己点提交。
 */
export async function fillActivePage({ identityId, templateId, targetUrl, anchor } = {}) {
  if (!(await tabsApi.hasHostAccess())) {
    throw new Error("缺少网页访问权限，请在设置里点「授权访问网页」。");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || "")) throw new Error("当前标签页不是普通网页");

  const [settings, state] = await Promise.all([store.getSettings(), store.getLocal()]);
  const identity = state.library.identities.find((i) => i.id === identityId) || state.library.identities[0];
  const template = state.library.templates.find((t) => t.id === templateId) || state.library.templates[0];
  if (!identity) throw new Error("请先在资源库创建一个身份");
  if (!template) throw new Error("请先在资源库创建一个评论模板");

  const site = targetUrl || identity.site;
  const payload = {
    name: identity.name,
    email: identity.email,
    site,
    anchor: anchor || identity.anchor,
    body: renderTemplate(template.body, { site, anchor: anchor || identity.anchor, name: identity.name }),
    typeSpeedMs: settings.typeSpeedMs,
    autoSubmit: false,
    rules: state.library.siteRules,
  };

  await tabsApi.injectAgent(tab.id);
  const frame = await tabsApi.locateFormFrame(tab.id, payload.rules);
  if (!frame || frame.classification !== "has_form") {
    if (frame?.captcha?.length) throw new Error(`此页有验证码：${frame.captcha.join(", ")}`);
    if (frame?.embedded?.length) throw new Error(`第三方评论系统（${frame.embedded.join(", ")}），需人工发布`);
    throw new Error("未找到评论表单");
  }
  const filled = await tabsApi.ask(tab.id, { type: "blf:fill", payload }, frame.frameId);
  if (!filled?.ok) throw new Error(filled?.reason || "填充失败");

  await store.update((s2) => ({ ...s2, candidates: setStatus(s2.candidates, tab.url, CANDIDATE_STATUS.FILLED) }));
  await log.info(`手动填充：${tab.url}`, { url: tab.url });
  return { ok: true, inIframe: frame.frameId !== 0 };
}

export async function start(taskId) {
  if (isRunning()) throw new Error("已有任务在运行，请先停止它。");
  if (!(await tabsApi.hasHostAccess())) {
    throw new Error("缺少网页访问权限，请在侧栏点「授权访问网页」。");
  }
  const state = await store.getLocal();
  const task = findTask(state.tasks, taskId);
  if (!task) throw new Error("任务不存在");
  if (isFinished(task)) throw new Error("任务已经跑完了");

  run.taskId = taskId;
  startKeepalive();
  await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { status: TASK_STATUS.RUNNING }) }));
  await log.info(`开始发布：${task.name}（剩余 ${task.urls.length - task.cursor} 条）`, { taskId });
  loop(taskId).catch(async (e) => {
    await log.error(`任务异常终止：${e.message || e}`, { taskId });
    await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { status: TASK_STATUS.ERROR, current: null }) }));
    stopKeepalive();
    run.taskId = null;
  });
}

export async function pause(taskId) {
  await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { status: TASK_STATUS.PAUSED, current: null }) }));
  run.abort?.();
  await log.info("已暂停", { taskId });
}

export async function stop(taskId) {
  await store.update((s) => ({ ...s, tasks: patchTask(s.tasks, taskId, { status: TASK_STATUS.IDLE, current: null }) }));
  run.abort?.();
  if (run.tabId) await tabsApi.closeTab(run.tabId);
  run.tabId = null;
  await log.info("已停止", { taskId });
}

/** assist 模式下侧栏点「已提交 / 跳过 / 失败」时调用。 */
export function decide(decision) {
  if (!run.decide) return false;
  run.decide(decision);
  run.decide = null;
  return true;
}
