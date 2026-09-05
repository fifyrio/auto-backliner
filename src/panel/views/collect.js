// 「收集」工作区：发现候选 → 筛选 → 勾选 → 建任务。

import { CANDIDATE_STATUS, MSG } from "../../shared/constants.js";
import { t } from "../../shared/i18n.js";
import { toCsv, truncate } from "../../shared/util.js";
import { call, hasHostAccess, requestHostAccess } from "../api.js";
import { h, mount, toast } from "../dom.js";

const STATUS_LABEL = {
  zh: { new: "未处理", opened: "已打开", has_form: "有表单", no_form: "无表单", captcha: "验证码", filled: "已填充", pending: "待审核", posted: "已发布", failed: "失败", skipped: "已跳过" },
  en: { new: "New", opened: "Opened", has_form: "Form", no_form: "No form", captcha: "Captcha", filled: "Filled", pending: "In review", posted: "Posted", failed: "Failed", skipped: "Skipped" },
};

// 视图局部状态：筛选条件与勾选集合不进持久化存储，关掉侧栏即重置。
const ui = { query: "", status: "all", selected: new Set(), credits: null, busy: false };

export function statusLabel(status, lang) {
  return (STATUS_LABEL[lang] || STATUS_LABEL.zh)[status] || status;
}

function visibleCandidates(state) {
  const q = ui.query.trim().toLowerCase();
  return Object.values(state.candidates)
    .filter((c) => (ui.status === "all" ? true : c.status === ui.status))
    .filter((c) => !q || `${c.root} ${c.title} ${c.anchor}`.toLowerCase().includes(q))
    .sort((a, b) => (b.domainRating ?? -1) - (a.domainRating ?? -1));
}

async function discover(state, render) {
  if (ui.busy) return;
  if (!state.settings.apiKey) return toast(t("needApiKey"), "error");
  const box = document.getElementById("domains");
  const domains = box.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!domains.length) return toast(t("domainsPlaceholder"), "error");

  ui.busy = true;
  render();
  for (const domain of domains) {
    try {
      const res = await call(MSG.DISCOVER, { domain });
      ui.credits = res.summary.remainingCredits ?? ui.credits;
      toast(`${domain}: +${res.added} / ${res.fetched}`, "ok");
    } catch (e) {
      toast(`${domain}: ${e.message}`, "error");
    }
  }
  ui.busy = false;
  render();
}

function candidateRow(c, state, render) {
  const checkbox = h("input", {
    type: "checkbox",
    checked: ui.selected.has(c.url),
    "aria-label": c.root,
    onChange: (e) => {
      if (e.target.checked) ui.selected.add(c.url);
      else ui.selected.delete(c.url);
      render();
    },
  });

  return h("article", { class: "cand" }, [
    checkbox,
    h("div", {}, [
      h("a", { class: "cand__root", href: c.url, target: "_blank", rel: "noreferrer noopener", text: c.root }),
      h("div", { class: "cand__title", text: truncate(c.title, 70) || "—" }),
      h("div", { class: "cand__meta" }, [
        c.domainRating != null && h("span", { class: "dr", text: `DR ${c.domainRating}` }),
        c.inRendered && h("span", { text: "rendered" }),
        c.anchor && h("span", { text: truncate(c.anchor, 20) }),
        c.discoveredFrom && h("span", { text: `← ${c.discoveredFrom}` }),
      ]),
    ]),
    // 状态可以人工改：有些站要过几天才放出评论，得回来自己标
    h("select", {
      class: `tag tag--${c.status}`,
      title: statusLabel(c.status, state.settings.lang),
      onChange: (e) => call(MSG.SET_CANDIDATE_STATUS, { url: c.url, status: e.target.value }),
    }, Object.values(CANDIDATE_STATUS).map((s) =>
      h("option", { value: s, text: statusLabel(s, state.settings.lang), selected: s === c.status }))),
  ]);
}

function exportCsv(state) {
  const columns = ["root", "domainRating", "inRendered", "anchor", "title", "url", "discoveredFrom", "status", "note"];
  const csv = toCsv(Object.values(state.candidates), columns);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: `backlink-candidates-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function taskForm(state, render) {
  const urls = [...ui.selected];
  const identity = h("select", {},
    state.library.identities.map((i) => h("option", { value: i.id, text: `${i.name} · ${i.site}` })));
  const template = h("select", {},
    state.library.templates.map((tm) => h("option", { value: tm.id, text: tm.name })));
  const name = h("input", { type: "text", placeholder: "Canva" });
  const target = h("input", { type: "text", placeholder: "https://your-site.com/page" });
  const anchor = h("input", { type: "text", placeholder: t("anchor") });

  return h("form", {
    class: "libitem",
    onSubmit: async (e) => {
      e.preventDefault();
      if (!state.library.identities.length) return toast(t("needIdentity"), "error");
      if (!state.library.templates.length) return toast(t("needTemplate"), "error");
      try {
        await call(MSG.TASK_CREATE, {
          name: name.value,
          targetUrl: target.value,
          anchor: anchor.value,
          identityId: identity.value,
          templateId: template.value,
          urls,
        });
        ui.selected.clear();
        document.querySelector('.tabbar__btn[data-view="publish"]').click();
      } catch (err) {
        toast(err.message, "error");
      }
    },
  }, [
    h("h2", { text: `${t("createTaskFromSelection")} · ${urls.length}` }),
    h("div", { class: "grid2" }, [
      h("div", { class: "field" }, [h("label", { text: t("name") }), name]),
      h("div", { class: "field" }, [h("label", { text: t("anchor") }), anchor]),
    ]),
    h("div", { class: "field" }, [h("label", { text: t("site") }), target]),
    h("div", { class: "grid2" }, [
      h("div", { class: "field" }, [h("label", { text: t("identities") }), identity]),
      h("div", { class: "field" }, [h("label", { text: t("templates") }), template]),
    ]),
    h("button", { class: "btn btn--primary", type: "submit", text: t("newTask") }),
  ]);
}

export function renderCollect(root, state, render) {
  const list = visibleCandidates(state);
  const total = Object.keys(state.candidates).length;
  const domainsValue = document.getElementById("domains")?.value || "";

  mount(root, [
    h("div", { class: "section-head" }, [
      h("h1", { text: t("collectTitle") }),
      ui.credits != null && h("span", { class: "muted", text: `${t("credits")} ${ui.credits}` }),
    ]),
    h("div", { class: "field" }, [
      h("textarea", { id: "domains", rows: 3, value: domainsValue, placeholder: t("domainsPlaceholder") }),
    ]),
    h("div", { class: "toolbar" }, [
      h("button", {
        class: "btn btn--primary",
        disabled: ui.busy,
        text: ui.busy ? t("discovering") : `🔍 ${t("discover")}`,
        onClick: () => discover(state, render),
      }),
      h("button", {
        class: "btn",
        text: `＋ ${t("addCurrentPage")}`,
        onClick: async () => {
          try {
            const res = await call(MSG.ADD_CURRENT_PAGE);
            toast(res.added ? "+1" : "已在候选库中", res.added ? "ok" : "info");
          } catch (e) {
            toast(e.message, "error");
          }
        },
      }),
      h("button", {
        class: "btn",
        text: `✍ ${t("fillCurrentPage")}`,
        onClick: async () => {
          try {
            if (!(await hasHostAccess()) && !(await requestHostAccess())) {
              return toast("需要网页访问权限才能填充", "error");
            }
            const res = await call(MSG.FILL_CURRENT_PAGE, {
              identityId: state.library.identities[0]?.id,
              templateId: state.library.templates[0]?.id,
            });
            toast(res.inIframe ? t("filledInIframe") : t("filledDone"), "ok");
          } catch (e) {
            toast(e.message, "error");
          }
        },
      }),
    ]),

    h("div", { class: "section-head", style: "margin-top:24px" }, [
      h("h1", { text: `${t("candidates")} · ${list.length}/${total}` }),
    ]),
    h("div", { class: "toolbar", style: "margin-bottom:12px" }, [
      h("select", {
        onChange: (e) => { ui.status = e.target.value; render(); },
      }, [
        h("option", { value: "all", text: t("filterAll"), selected: ui.status === "all" }),
        ...Object.values(CANDIDATE_STATUS).map((s) =>
          h("option", { value: s, text: statusLabel(s, state.settings.lang), selected: ui.status === s })),
      ]),
      h("input", {
        type: "text",
        value: ui.query,
        placeholder: t("searchPlaceholder"),
        style: "flex:1;min-width:110px",
        onInput: (e) => { ui.query = e.target.value; render(); },
      }),
      h("button", {
        class: "btn btn--sm",
        text: t("selectAll"),
        onClick: () => {
          const allSelected = list.length > 0 && list.every((c) => ui.selected.has(c.url));
          list.forEach((c) => (allSelected ? ui.selected.delete(c.url) : ui.selected.add(c.url)));
          render();
        },
      }),
      h("button", { class: "btn btn--sm", text: t("exportCsv"), onClick: () => exportCsv(state) }),
      ui.selected.size > 0 && h("button", {
        class: "btn btn--sm btn--danger",
        text: `${t("remove")} · ${ui.selected.size}`,
        onClick: async () => {
          const urls = [...ui.selected];
          ui.selected.clear();
          await call(MSG.DELETE_CANDIDATES, { urls });
        },
      }),
    ]),

    ui.selected.size > 0 ? taskForm(state, render) : null,

    list.length
      ? list.map((c) => candidateRow(c, state, render))
      : h("p", { class: "empty", text: t("noCandidates") }),
  ]);
}
