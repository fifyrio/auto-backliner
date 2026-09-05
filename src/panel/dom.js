// 极小的 DOM 构建器。全部走 textContent / setAttribute，
// 页面数据（标题、锚文本、URL）永远不会被当作 HTML 解析 —— v1 的
// options.js 直接把 API 返回的字段拼进 innerHTML，那是个注入面。

export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [children].flat(3)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function mount(container, ...nodes) {
  container.replaceChildren(...nodes.flat(3).filter(Boolean));
}

let toastTimer;
export function toast(message, kind = "info") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.dataset.kind = kind;
  el.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.dataset.show = "false"), 3200);
}
