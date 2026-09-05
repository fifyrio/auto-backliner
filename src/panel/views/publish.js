// 「发布」工作区：任务列表 + 当前运行面板 + assist 模式的人工裁决。

import { MSG, SUBMIT_MODE, TASK_STATUS } from "../../shared/constants.js";
import { t } from "../../shared/i18n.js";
import { call, hasHostAccess, requestHostAccess } from "../api.js";
import { h, mount, toast } from "../dom.js";

const ui = { expanded: new Set() };

async function guardedStart(taskId) {
  try {
    if (!(await hasHostAccess())) {
      const granted = await requestHostAccess();
      if (!granted) return toast("需要网页访问权限才能自动填充", "error");
    }
    await call(MSG.TASK_START, { taskId });
  } catch (e) {
    toast(e.message, "error");
  }
}

function taskActions(task, render) {
  const running = task.status === TASK_STATUS.RUNNING;
  return h("div", { class: "task__actions" }, [
    running
      ? h("button", { class: "btn btn--icon", title: t("pause"), text: "❚❚", onClick: () => call(MSG.TASK_PAUSE, { taskId: task.id }) })
      : h("button", { class: "btn btn--icon btn--primary", title: t("start"), text: "▶", disabled: task.computed.remaining === 0, onClick: () => guardedStart(task.id) }),
    h("button", { class: "btn btn--icon", title: t("stop"), text: "■", disabled: !running, onClick: () => call(MSG.TASK_STOP, { taskId: task.id }) }),
    h("button", {
      class: "btn btn--icon",
      title: t("detail"),
      text: "☰",
      "aria-expanded": ui.expanded.has(task.id) ? "true" : "false",
      onClick: () => {
        if (ui.expanded.has(task.id)) ui.expanded.delete(task.id);
        else ui.expanded.add(task.id);
        render();
      },
    }),
    h("button", {
      class: "btn btn--icon btn--danger",
      title: t("remove"),
      text: "✕",
      onClick: () => confirm(`${t("remove")}「${task.name}」?`) && call(MSG.TASK_DELETE, { taskId: task.id }),
    }),
  ]);
}

function taskCard(task, render) {
  const s = task.computed;
  const doneRatio = s.total ? (s.total - s.remaining) / s.total : 0;

  return h("article", { class: "task", dataset: { status: task.status } }, [
    h("div", { class: "task__head" }, [
      h("div", {}, [
        h("div", { class: "task__target", text: task.targetUrl || "—" }),
        h("div", { class: "task__name", text: task.name }),
        h("div", { class: "task__counts" }, [
          h("span", { title: t("taskSuccess") }, [h("b", { text: `✓${s.success}` })]),
          h("span", { title: t("taskPending") }, [h("b", { text: `⧗${s.pending}` })]),
          h("span", { title: t("taskFailed") }, [h("b", { text: `✕${s.failed}` })]),
          h("span", { text: `${t("taskRemaining")} ${s.remaining}` }),
        ]),
      ]),
      taskActions(task, render),
    ]),
    h("div", { class: "progress" }, [
      h("div", { class: "progress__bar", style: `transform: scaleX(${doneRatio})` }),
    ]),
    ui.expanded.has(task.id) && h("ol", { class: "muted", style: "margin:12px 0 0;padding-left:18px;max-height:180px;overflow:auto" },
      task.urls.map((u, i) => h("li", {
        style: i < task.cursor ? "opacity:.45" : "",
        text: u.replace(/^https?:\/\//, ""),
      }))),
  ]);
}

function decisionPanel(task) {
  const url = task.current?.url || "";
  const decide = (result, reason) => call(MSG.RUN_DECISION, { decision: { result, reason } });

  return h("div", { class: "awaiting" }, [
    h("strong", { text: t("waitingReview") }),
    h("div", { class: "awaiting__url", text: url }),
    h("div", { class: "toolbar" }, [
      h("button", { class: "btn btn--sm", text: t("openTab"), onClick: () => chrome.tabs.create({ url }) }),
      h("button", { class: "btn btn--sm btn--primary", text: t("markPosted"), onClick: () => decide("success") }),
      h("button", { class: "btn btn--sm", text: t("markSkip"), onClick: () => decide("skipped", "人工跳过") }),
      h("button", { class: "btn btn--sm btn--danger", text: t("markFailed"), onClick: () => decide("failed", "人工判定失败") }),
    ]),
  ]);
}

function runCard(task) {
  const s = task.computed;
  const stat = (key, value, modifier) =>
    h("div", { class: `stat ${modifier || ""}` }, [
      h("b", { class: "stat__num", text: String(value) }),
      h("span", { class: "stat__label", text: t(key) }),
    ]);

  return h("section", { class: "runcard" }, [
    h("div", { class: "runcard__head" }, [
      h("span", { class: "pulse", "aria-hidden": "true" }),
      h("span", { text: `${t("running")} ${task.name}` }),
    ]),
    h("div", { class: "stats" }, [
      stat("taskTotal", s.total),
      stat("taskSuccess", s.success, "stat--success"),
      stat("taskPending", s.pending, "stat--pending"),
      stat("taskFailed", s.failed, "stat--failed"),
      stat("taskRemaining", s.remaining),
    ]),
    task.current?.phase === "awaiting" ? decisionPanel(task) : null,
    task.current?.phase === "filling"
      ? h("p", { class: "muted", style: "margin:16px 0 0;word-break:break-all", text: task.current.url })
      : null,
  ]);
}

export function renderPublish(root, state, render) {
  const active = state.tasks.find((t2) => t2.status === TASK_STATUS.RUNNING);
  const assist = state.settings.submitMode === SUBMIT_MODE.ASSIST;

  mount(root, [
    h("div", { class: "section-head" }, [
      h("h1", { text: t("publishTitle") }),
      h("button", {
        class: "btn btn--primary",
        text: t("newTask"),
        onClick: () => document.querySelector('.tabbar__btn[data-view="collect"]').click(),
      }),
    ]),
    state.tasks.length
      ? state.tasks.map((task) => taskCard(task, render))
      : h("p", { class: "empty", text: t("noTasks") }),
    active ? runCard(active) : null,
    active && assist
      ? h("p", { class: "muted", style: "margin-top:12px", text: t("modeAssist") })
      : null,
    !active && state.tasks.some((t2) => t2.status === TASK_STATUS.PAUSED)
      ? h("p", { class: "muted", style: "margin-top:12px", text: t("paused") })
      : null,
  ]);
}
