// 「日志」工作区：倒序展示运行事件，可按级别过滤、导出。

import { LOG_LEVEL, MSG } from "../../shared/constants.js";
import { t } from "../../shared/i18n.js";
import { formatTime } from "../../shared/util.js";
import { call } from "../api.js";
import { h, mount } from "../dom.js";

const ui = { level: "all" };

function exportLogs(logs) {
  const text = logs
    .map((l) => `${new Date(l.ts).toISOString()}\t${l.level}\t${l.message}`)
    .join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  h("a", { href: url, download: `backlink-log-${Date.now()}.txt` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderLogs(root, state, render) {
  const logs = [...state.logs]
    .filter((l) => ui.level === "all" || l.level === ui.level)
    .reverse();

  mount(root, [
    h("div", { class: "section-head" }, [
      h("h1", { text: t("logsTitle") }),
      h("div", { class: "toolbar" }, [
        h("select", { onChange: (e) => { ui.level = e.target.value; render(); } }, [
          h("option", { value: "all", text: t("filterAll"), selected: ui.level === "all" }),
          ...Object.values(LOG_LEVEL).map((lv) =>
            h("option", { value: lv, text: lv, selected: ui.level === lv })),
        ]),
        h("button", { class: "btn btn--sm", text: t("exportCsv"), onClick: () => exportLogs(state.logs) }),
        h("button", {
          class: "btn btn--sm btn--danger",
          text: t("clearLogs"),
          onClick: () => call(MSG.CLEAR_LOGS),
        }),
      ]),
    ]),
    logs.length
      ? logs.map((l) =>
          h("div", { class: "logline", dataset: { level: l.level } }, [
            h("time", { datetime: new Date(l.ts).toISOString(), text: formatTime(l.ts) }),
            h("span", { text: l.message }),
          ]))
      : h("p", { class: "empty", text: t("noLogs") }),
  ]);
}
