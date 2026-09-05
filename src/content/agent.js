// 内容脚本的消息端 + 页面内轻量指示条。
// 只在被任务注入时出现，不会在你日常浏览的页面上冒出来。

(() => {
  const BLF = (window.__BLF = window.__BLF || {});
  if (BLF.agentReady) return;
  BLF.agentReady = true;

  const HUD_ID = "blf-hud";
  const HUD_TEXT = {
    filling: "外链助手正在填充评论…",
    has_form: "已填好，请检查后手动提交",
    captcha: "这页有验证码，需要你人工处理",
    no_form: "没找到评论表单",
    embedded: "第三方评论系统，需人工发布",
  };

  function hud(state) {
    let el = document.getElementById(HUD_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = HUD_ID;
      el.setAttribute("role", "status");
      document.documentElement.appendChild(el);
    }
    el.dataset.state = state;
    el.textContent = HUD_TEXT[state] || state;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("blf:")) return false;

    (async () => {
      switch (msg.type) {
        case "blf:detect": {
          const found = BLF.detect(msg.rules);
          hud(found.classification);
          sendResponse({ classification: found.classification, captcha: found.captcha, embedded: found.embedded });
          break;
        }
        case "blf:fill": {
          hud("filling");
          const res = await BLF.fill(msg.payload);
          hud(res.ok ? "has_form" : res.classification || "no_form");
          sendResponse(res);
          break;
        }
        case "blf:submit":
          sendResponse(await BLF.submit());
          break;
        case "blf:readPage":
          sendResponse(BLF.readPage());
          break;
        default:
          sendResponse(null);
      }
    })().catch((e) => sendResponse({ ok: false, reason: e.message || String(e) }));

    return true; // 异步响应
  });
})();
