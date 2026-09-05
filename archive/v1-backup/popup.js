// popup.js
const LABEL = { has_form: "✓ 检测到评论表单", no_form: "未检测到评论表单", captcha: "⚠ 页面有验证码" };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const cfg = await chrome.storage.sync.get(["apiKey"]);
  document.getElementById("keyWarn").style.display = cfg.apiKey ? "none" : "block";

  const tab = await activeTab();
  const stat = document.getElementById("stat");
  try {
    const cls = await chrome.tabs.sendMessage(tab.id, { type: "getPageClassification" });
    if (cls && cls.key) {
      stat.textContent = LABEL[cls.key] || cls.label || "已检测";
      stat.className = "stat " + cls.key;
    } else {
      stat.textContent = "此页面无评论区";
    }
  } catch (e) {
    stat.textContent = "无法在此页面运行（可能是浏览器内部页）";
  }
}

document.getElementById("fill").addEventListener("click", async () => {
  const tab = await activeTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "fillNow" });
    window.close();
  } catch (e) {
    document.getElementById("stat").textContent = "此页面无法填充";
  }
});

document.getElementById("dash").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
