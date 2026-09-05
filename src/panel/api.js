// 侧栏 → background 的调用封装：统一解包 {ok, data, error}，失败直接抛。

export async function call(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw new Error("后台无响应，请重新打开侧边栏。");
  if (!res.ok) throw new Error(res.error || "未知错误");
  return res.data;
}

/** <all_urls> 是可选权限，必须在用户点击的手势里申请。 */
export function requestHostAccess() {
  return chrome.permissions.request({ origins: ["<all_urls>"] });
}

export function hasHostAccess() {
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}
