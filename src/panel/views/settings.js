// 「设置」：从页脚进入。分成 API、发布节流、提交方式三组。

import { MSG, SUBMIT_MODE } from "../../shared/constants.js";
import { t } from "../../shared/i18n.js";
import { call, hasHostAccess, requestHostAccess } from "../api.js";
import { h, mount, toast } from "../dom.js";

function numberField(labelKey, key, settings, { min = 0, max = 9999, step = 1 } = {}) {
  return h("div", { class: "field" }, [
    h("label", { text: t(labelKey) }),
    h("input", {
      type: "number",
      min, max, step,
      value: settings[key],
      onChange: (e) => call(MSG.SAVE_SETTINGS, { patch: { [key]: Number(e.target.value) } }),
    }),
  ]);
}

function checkboxField(labelKey, key, settings) {
  const box = h("input", {
    type: "checkbox",
    checked: !!settings[key],
    onChange: (e) => call(MSG.SAVE_SETTINGS, { patch: { [key]: e.target.checked } }),
  });
  return h("label", { class: "field field--row" }, [box, h("span", { text: t(labelKey) })]);
}

export function renderSettings(root, state, render) {
  const s = state.settings;
  const keyInput = h("input", { type: "password", value: s.apiKey, placeholder: "sk-…", autocomplete: "off" });

  mount(root, [
    h("div", { class: "section-head" }, [
      h("h1", { text: t("settingsTitle") }),
      h("button", { class: "btn btn--sm", text: t("cancel"), onClick: () => document.getElementById("openSettings").click() }),
    ]),

    h("h2", { text: "API" }),
    h("div", { class: "field" }, [
      h("label", { text: t("apiKey") }),
      h("div", { class: "field--row" }, [
        keyInput,
        h("button", {
          class: "btn btn--icon",
          type: "button",
          title: "toggle",
          text: "👁",
          onClick: () => (keyInput.type = keyInput.type === "password" ? "text" : "password"),
        }),
        h("button", {
          class: "btn btn--primary",
          type: "button",
          text: t("save"),
          onClick: async () => {
            await call(MSG.SAVE_SETTINGS, { patch: { apiKey: keyInput.value.trim() } });
            toast(t("saved"), "ok");
          },
        }),
      ]),
      h("p", { class: "muted", text: t("apiKeyHint") }),
    ]),

    h("h2", { text: t("submitMode") }),
    h("div", { class: "field" }, [
      h("select", {
        onChange: (e) => call(MSG.SAVE_SETTINGS, { patch: { submitMode: e.target.value } }),
      }, [
        h("option", { value: SUBMIT_MODE.ASSIST, text: t("modeAssist"), selected: s.submitMode === SUBMIT_MODE.ASSIST }),
        h("option", { value: SUBMIT_MODE.AUTO, text: t("modeAuto"), selected: s.submitMode === SUBMIT_MODE.AUTO }),
      ]),
      s.submitMode === SUBMIT_MODE.AUTO
        ? h("p", { class: "muted", style: "color:var(--warn)", text: t("autoWarning") })
        : null,
    ]),

    h("h2", { text: t("collectTitle") }),
    h("div", { class: "grid2" }, [
      numberField("perRootLimit", "perRootLimit", s, { min: 1, max: 50 }),
      numberField("minDr", "minDomainRating", s, { min: 0, max: 100 }),
    ]),
    checkboxField("dofollowOnly", "dofollowOnly", s),

    h("h2", { text: t("publishTitle") }),
    h("div", { class: "grid2" }, [
      numberField("typeSpeed", "typeSpeedMs", s, { min: 10, max: 400, step: 5 }),
      numberField("rootCooldown", "rootCooldownMin", s, { min: 0, max: 1440 }),
    ]),
    h("div", { class: "grid2" }, [
      numberField(`${t("gapRange")} · min`, "gapMinSec", s, { min: 3, max: 600 }),
      numberField(`${t("gapRange")} · max`, "gapMaxSec", s, { min: 3, max: 900 }),
    ]),
    checkboxField("closeTabAfter", "closeTabAfter", s),

    h("h2", { text: "权限" }),
    h("button", {
      class: "btn",
      text: "授权访问网页 (<all_urls>)",
      onClick: async () => {
        const already = await hasHostAccess();
        if (already) return toast("已授权", "ok");
        const granted = await requestHostAccess();
        toast(granted ? "已授权" : "未授权", granted ? "ok" : "error");
      },
    }),
    h("p", { class: "muted", text: "只有发布任务打开的标签页才会被注入脚本；日常浏览不受影响。" }),
  ]);
}
