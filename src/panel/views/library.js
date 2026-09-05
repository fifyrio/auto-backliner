// 「资源库」工作区：身份、评论模板、站点规则。
// 任务只存 id 引用，改一次模板，后续所有任务都跟着变。

import { MSG } from "../../shared/constants.js";
import { t } from "../../shared/i18n.js";
import { renderTemplate, truncate } from "../../shared/util.js";
import { call } from "../api.js";
import { h, mount, toast } from "../dom.js";

const ui = { editing: null }; // { kind, item }

const SCHEMAS = {
  identities: [
    { key: "name", label: "name" },
    { key: "email", label: "email" },
    { key: "site", label: "site" },
    { key: "anchor", label: "anchor" },
  ],
  templates: [
    { key: "name", label: "name" },
    { key: "body", label: "templateBody", multiline: true, hint: "templateHint" },
  ],
  siteRules: [
    { key: "domain", label: "domain" },
    { key: "comment", label: "comment selector" },
    { key: "author", label: "author selector" },
    { key: "email", label: "email selector" },
    { key: "url", label: "url selector" },
    { key: "submit", label: "submit selector" },
  ],
};

function summarize(kind, item) {
  if (kind === "identities") return `${item.email} · ${item.site}`;
  if (kind === "templates") return truncate(item.body, 160);
  return Object.entries(item)
    .filter(([k]) => !["id", "domain", "updatedAt"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function editor(kind, item, render) {
  const inputs = new Map();
  const fields = SCHEMAS[kind].map((f) => {
    const control = f.multiline
      ? h("textarea", { rows: 4, value: item[f.key] || "" })
      : h("input", { type: "text", value: item[f.key] || "" });
    inputs.set(f.key, control);
    return h("div", { class: "field" }, [
      h("label", { text: t(f.label) === f.label ? f.label : t(f.label) }),
      control,
      f.hint && h("p", { class: "muted", text: t(f.hint) }),
    ]);
  });

  return h("form", {
    class: "libitem",
    onSubmit: async (e) => {
      e.preventDefault();
      const next = { id: item.id };
      inputs.forEach((el, key) => (next[key] = el.value.trim()));
      if (kind === "templates" && !next.body) return toast(t("templateBody"), "error");
      await call(MSG.LIBRARY_SAVE, { kind, item: next });
      ui.editing = null;
      render();
    },
  }, [
    ...fields,
    kind === "templates" && inputs.get("body").value
      ? h("p", { class: "muted", text: `→ ${renderTemplate(inputs.get("body").value, { site: "https://your-site.com", anchor: "anchor", name: "You" })}` })
      : null,
    h("div", { class: "toolbar" }, [
      h("button", { class: "btn btn--primary", type: "submit", text: t("save") }),
      h("button", { class: "btn", type: "button", text: t("cancel"), onClick: () => { ui.editing = null; render(); } }),
    ]),
  ]);
}

function section(kind, labelKey, state, render) {
  const items = state.library[kind] || [];
  const editing = ui.editing?.kind === kind ? ui.editing.item : null;

  return h("div", { style: "margin-bottom:28px" }, [
    h("div", { class: "section-head" }, [
      h("h1", { text: t(labelKey) }),
      h("button", {
        class: "btn btn--sm",
        text: `＋ ${t("add")}`,
        onClick: () => { ui.editing = { kind, item: {} }; render(); },
      }),
    ]),
    editing ? editor(kind, editing, render) : null,
    items.length === 0 && !editing ? h("p", { class: "empty", text: "—" }) : null,
    ...items.map((item) =>
      h("article", { class: "libitem" }, [
        h("div", { class: "libitem__head" }, [
          h("strong", { text: item.name || item.domain || item.id }),
          h("div", { class: "toolbar" }, [
            h("button", { class: "btn btn--sm", text: "✎", title: t("save"), onClick: () => { ui.editing = { kind, item }; render(); } }),
            h("button", {
              class: "btn btn--sm btn--danger",
              text: "✕",
              title: t("remove"),
              onClick: () => call(MSG.LIBRARY_DELETE, { kind, id: item.id }),
            }),
          ]),
        ]),
        h("div", { class: "libitem__body", text: summarize(kind, item) }),
      ])),
  ]);
}

export function renderLibrary(root, state, render) {
  mount(root, [
    section("identities", "identities", state, render),
    section("templates", "templates", state, render),
    section("siteRules", "siteRules", state, render),
    h("p", { class: "muted", text: t("selectorHint") }),
  ]);
}
