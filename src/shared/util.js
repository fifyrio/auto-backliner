// 纯函数工具集：URL 规范化、随机、模板渲染、CSV。无副作用，便于单测。

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 取根域名用于去重与冷却。去掉 www. 前缀，小写。 */
export function rootDomain(urlOrHost) {
  const raw = String(urlOrHost || "").trim();
  if (!raw) return "";
  try {
    const host = /^https?:\/\//i.test(raw) ? new URL(raw).hostname : raw.split("/")[0];
    return host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** 只接受 http/https，挡掉 javascript: / data: 这类注入向量。 */
export function safeHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

/** 候选库主键：去掉 hash 与常见跟踪参数，避免同一页面重复入库。 */
export function canonicalUrl(value) {
  const href = safeHttpUrl(value);
  if (!href) return "";
  const u = new URL(href);
  u.hash = "";
  const junk = /^(utm_|fbclid$|gclid$|ref$|source$)/i;
  [...u.searchParams.keys()].forEach((k) => junk.test(k) && u.searchParams.delete(k));
  return u.toString();
}

/** 把域名输入清洗成 API 可用的裸域名。 */
export function cleanDomain(input) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * 渲染评论模板：支持 {site} {anchor} {name} 占位符，以及
 * spintax {a|b|c} —— 每次渲染随机取一项，让同一模板不会留下完全相同的指纹。
 */
export function renderTemplate(tpl, vars) {
  const withVars = String(tpl || "").replace(/\{(\w+)\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : m
  );
  return withVars.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, group) => {
    const options = group.split("|");
    return options[randInt(0, options.length - 1)].trim();
  });
}

export function truncate(text, max) {
  const s = String(text || "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function csvCell(value) {
  const s = String(value == null ? "" : value).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  rows.forEach((row) => lines.push(columns.map((c) => csvCell(row[c])).join(",")));
  return `﻿${lines.join("\n")}`; // BOM，保证 Excel 正确识别 UTF-8
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
