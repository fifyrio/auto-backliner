// 侧栏入口：拉快照 → 渲染当前视图 → 监听后台广播重渲染。

import { MSG } from "../shared/constants.js";
import { setLang, t } from "../shared/i18n.js";
import { call } from "./api.js";
import { toast } from "./dom.js";
import { renderCollect } from "./views/collect.js";
import { renderPublish } from "./views/publish.js";
import { renderLogs } from "./views/logs.js";
import { renderLibrary } from "./views/library.js";
import { renderSettings } from "./views/settings.js";

const VIEWS = {
  collect: renderCollect,
  publish: renderPublish,
  logs: renderLogs,
  library: renderLibrary,
  settings: renderSettings,
};

const TAB_KEYS = { collect: "tabCollect", publish: "tabPublish", logs: "tabLogs", library: "tabLibrary" };

let state = null;
let activeView = "collect";
let settingsOpen = false;
let pendingRender = false;

/** 用户正在输入时不重渲染，否则会打断光标；等失焦后补上。 */
function isTyping() {
  const el = document.activeElement;
  return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function render() {
  if (!state) return;
  const viewName = settingsOpen ? "settings" : activeView;
  const scroller = document.getElementById("main");
  const scrollTop = scroller.scrollTop;

  for (const name of Object.keys(VIEWS)) {
    const section = document.getElementById(`view-${name}`);
    section.hidden = name !== viewName;
  }
  VIEWS[viewName](document.getElementById(`view-${viewName}`), state, render);

  document.querySelectorAll(".tabbar__btn").forEach((btn) => {
    const selected = !settingsOpen && btn.dataset.view === activeView;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    btn.textContent = t(TAB_KEYS[btn.dataset.view]);
  });
  moveIndicator();
  renderFooter();
  scroller.scrollTop = scrollTop; // 重渲染后回到原位置，别把用户滚到顶部
}

function moveIndicator() {
  const index = Object.keys(TAB_KEYS).indexOf(activeView);
  document.getElementById("tabIndicator").style.transform = `translateX(${index * 100}%)`;
}

function renderFooter() {
  document.getElementById("openSettings").textContent = t("settings");
  document.getElementById("clearData").textContent = t("clearData");
  document.getElementById("langSelect").value = state.settings.lang;
}

async function refresh() {
  state = await call(MSG.GET_SNAPSHOT);
  setLang(state.settings.lang);
  render();
}

function scheduleRefresh() {
  if (isTyping()) {
    if (pendingRender) return;
    pendingRender = true;
    document.addEventListener("focusout", () => {
      pendingRender = false;
      refresh();
    }, { once: true });
    return;
  }
  refresh();
}

function bind() {
  document.getElementById("tabbar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tabbar__btn");
    if (!btn) return;
    activeView = btn.dataset.view;
    settingsOpen = false;
    render();
  });

  document.getElementById("openSettings").addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    render();
  });

  document.getElementById("clearData").addEventListener("click", async () => {
    if (!confirm(t("confirmClear"))) return;
    await call(MSG.CLEAR_DATA);
    toast(t("saved"), "ok");
  });

  document.getElementById("langSelect").addEventListener("change", async (e) => {
    await call(MSG.SAVE_SETTINGS, { patch: { lang: e.target.value } });
    await refresh();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.STATE_CHANGED) scheduleRefresh();
  });
}

bind();
refresh().catch((e) => toast(e.message, "error"));
