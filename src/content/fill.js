// 拟真填充 + 提交结果判定。

(() => {
  const BLF = (window.__BLF = window.__BLF || {});
  if (BLF.fill) return;

  const TYPE_CHAR_CAP = 400; // 长正文不逐字符打，否则一条要打一分钟
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  /** 用原生 setter 写值，才能触发 React/Vue 的受控组件更新。 */
  function nativeSetValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  }

  function emit(el, type, init = {}) {
    el.dispatchEvent(new (type.startsWith("key") ? KeyboardEvent : Event)(type, { bubbles: true, ...init }));
  }

  async function typeInto(el, text, speedMs) {
    if (!el || text == null) return;
    el.focus();
    emit(el, "focus");
    nativeSetValue(el, "");
    emit(el, "input");

    const str = String(text);
    if (str.length > TYPE_CHAR_CAP) {
      // 超长文本分块写入：既不慢，也不像一次性粘贴那样只有一个 input 事件
      for (let i = 0; i < str.length; i += 40) {
        nativeSetValue(el, str.slice(0, i + 40));
        emit(el, "input");
        await sleep(rand(40, 120));
      }
    } else {
      let cur = "";
      for (const ch of str) {
        cur += ch;
        nativeSetValue(el, cur);
        emit(el, "keydown", { key: ch });
        emit(el, "input");
        emit(el, "keyup", { key: ch });
        // 标点后停顿更久，接近真人节奏
        const pause = /[.,!?。，！？]/.test(ch) ? speedMs * 4 : speedMs;
        await sleep(rand(Math.round(pause * 0.5), Math.round(pause * 1.8)));
      }
    }
    emit(el, "change");
    emit(el, "blur");
  }

  BLF.fill = async function fill(payload) {
    const found = BLF.detect(payload.rules);
    if (found.captcha.length) return { ok: false, captcha: found.captcha, classification: "captcha" };
    if (!found.fields.comment) {
      return {
        ok: false,
        reason: found.embedded.length ? `第三方评论系统：${found.embedded.join(", ")}` : "未找到评论正文框",
        classification: found.classification,
      };
    }

    const speed = Math.max(10, Number(payload.typeSpeedMs) || 60);
    found.fields.comment.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(rand(700, 1600)); // 模拟“先读一下这篇文章”

    if (found.fields.author) await typeInto(found.fields.author, payload.name, speed);
    if (found.fields.email) await typeInto(found.fields.email, payload.email, speed);
    if (found.fields.url) await typeInto(found.fields.url, payload.site, speed);
    await typeInto(found.fields.comment, payload.body, speed);

    BLF.lastFound = found;
    return { ok: true, classification: "has_form", hasSubmit: !!found.submit };
  };

  const SUCCESS_HINTS = /awaiting moderation|待审核|等待审核|comment is awaiting|held for moderation/i;
  const POSTED_HINTS = /comment (has been )?(posted|submitted)|评论已发布|发表成功|感谢您的评论|thanks for commenting/i;
  const FAIL_HINTS = /error|失败|too fast|duplicate comment|spam|请稍后|slow down/i;

  /** 提交后读页面反馈，区分「已发布 / 待审核 / 失败」。 */
  function readOutcome(before) {
    const text = document.body.innerText.slice(0, 20000);
    if (SUCCESS_HINTS.test(text)) return { result: "pending", reason: "待人工审核" };
    if (POSTED_HINTS.test(text)) return { result: "success" };
    if (FAIL_HINTS.test(text)) {
      const line = text.split("\n").find((l) => FAIL_HINTS.test(l)) || "页面提示错误";
      return { result: "failed", reason: line.trim().slice(0, 120) };
    }
    // 表单没了 / 正文框被清空，通常意味着提交成功走到了新页面
    const gone = !document.body.contains(before) || (before.value === "" && before.offsetParent === null);
    return gone ? { result: "pending", reason: "已提交，未读到明确回执" } : { result: "failed", reason: "提交后页面无变化" };
  }

  /** 提交后若页面跳转，内容脚本会被销毁；重新注入后用这个只读页面文案。 */
  BLF.readPage = function readPage() {
    const text = document.body.innerText.slice(0, 20000);
    if (SUCCESS_HINTS.test(text)) return { result: "pending", reason: "待人工审核" };
    if (POSTED_HINTS.test(text)) return { result: "success" };
    if (FAIL_HINTS.test(text)) return { result: "failed", reason: "页面提示提交失败" };
    return { result: "pending", reason: "已提交，未读到明确回执" };
  };

  BLF.submit = async function submit() {
    const found = BLF.lastFound || BLF.detect();
    if (!found.submit) return { result: "failed", reason: "未找到提交按钮" };
    const commentEl = found.fields.comment;
    await sleep(rand(800, 2000)); // 填完立刻点提交太机械
    found.submit.click();
    await sleep(4000);
    return readOutcome(commentEl);
  };
})();
