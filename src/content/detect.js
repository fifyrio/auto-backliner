// 评论表单识别。按需注入，不常驻。
// v1 用「第一个匹配到的选择器」取字段，遇到搜索框、订阅框会误判。
// 这里改成打分：先按 name/id/autocomplete 精确匹配，再看 placeholder、
// 关联 label、所在表单，取分最高且分数达标的元素。

(() => {
  const BLF = (window.__BLF = window.__BLF || {});
  if (BLF.detect) return;

  const MIN_SCORE = 2; // 低于此分视为没找到，宁可漏也不要填错框

  const FIELD_HINTS = {
    comment: {
      tag: "textarea",
      exact: [/^comment$/i, /^comment_content$/i, /^message$/i, /^body$/i, /^text$/i],
      fuzzy: [/comment/i, /message/i, /reply/i, /评论/, /留言/],
      negative: [/search/i, /subject/i, /title/i],
    },
    author: {
      tag: "input",
      types: ["text", ""],
      exact: [/^author$/i, /^name$/i, /^comment_author$/i, /^fullname$/i],
      fuzzy: [/name/i, /author/i, /nick/i, /昵称/, /姓名/],
      negative: [/user(name)?_?login/i, /search/i, /company/i],
      autocomplete: ["name", "nickname", "given-name"],
    },
    email: {
      tag: "input",
      types: ["email", "text", ""],
      exact: [/^email$/i, /^comment_author_email$/i, /^mail$/i],
      fuzzy: [/e-?mail/i, /邮箱/],
      negative: [/subscribe/i, /newsletter/i],
      autocomplete: ["email"],
    },
    url: {
      tag: "input",
      types: ["url", "text", ""],
      exact: [/^url$/i, /^website$/i, /^comment_author_url$/i, /^site$/i],
      fuzzy: [/url/i, /website/i, /homepage/i, /网站/],
      negative: [/search/i],
      autocomplete: ["url"],
    },
  };

  const CAPTCHA_PROBES = [
    ['iframe[src*="recaptcha"], .g-recaptcha', "reCAPTCHA"],
    ['iframe[src*="hcaptcha"], .h-captcha', "hCaptcha"],
    ['iframe[src*="turnstile"], .cf-turnstile', "Turnstile"],
    ['input[name*="captcha" i], img[src*="captcha" i]', "图形验证码"],
  ];

  const EMBEDDED_SYSTEMS = [
    ["#disqus_thread, iframe[src*='disqus.com']", "Disqus"],
    ["iframe[src*='facebook.com/plugins/comments']", "Facebook Comments"],
    ["iframe[src*='utteranc.es'], iframe[src*='giscus']", "GitHub 评论"],
    ["iframe[src*='intensedebate']", "IntenseDebate"],
  ];

  const isVisible = (el) => {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.type === "hidden") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  function labelText(el) {
    const parts = [el.placeholder, el.getAttribute("aria-label"), el.title];
    if (el.id) {
      const lb = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lb) parts.push(lb.textContent);
    }
    const wrapper = el.closest("label");
    if (wrapper) parts.push(wrapper.textContent);
    return parts.filter(Boolean).join(" ").slice(0, 200);
  }

  function scoreField(el, hint) {
    const name = `${el.name || ""} ${el.id || ""}`;
    const label = labelText(el);
    if (hint.negative?.some((re) => re.test(name))) return -1;

    let score = 0;
    if (hint.exact.some((re) => re.test(el.name) || re.test(el.id))) score += 4;
    else if (hint.fuzzy.some((re) => re.test(name))) score += 2;
    if (hint.fuzzy.some((re) => re.test(label))) score += 1;
    if (hint.autocomplete?.includes(el.autocomplete)) score += 2;
    if (hint.types && el.tagName === "INPUT" && el.type === hint.types[0]) score += 2;
    if (el.closest("form")?.matches("#commentform, .comment-form, form[id*=comment i]")) score += 2;
    if (el.required) score += 1;
    return score;
  }

  function pick(kind, scope) {
    const hint = FIELD_HINTS[kind];
    const nodes = [...scope.querySelectorAll(hint.tag)].filter(isVisible);
    let best = null;
    let bestScore = MIN_SCORE - 1;
    for (const el of nodes) {
      const score = scoreField(el, hint);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    // 页面上只有一个可见 textarea 时，即使没有语义线索也认为它就是评论框
    if (!best && kind === "comment" && nodes.length === 1) return nodes[0];
    return best;
  }

  /** 站点自定义规则优先于自动识别。 */
  function applyRules(rules) {
    const host = location.hostname.replace(/^www\./, "");
    const rule = (rules || []).find((r) => host === r.domain || host.endsWith(`.${r.domain}`));
    if (!rule) return {};
    const out = {};
    for (const key of ["comment", "author", "email", "url", "submit"]) {
      if (!rule[key]) continue;
      const el = document.querySelector(rule[key]);
      if (el) out[key] = el;
    }
    return out;
  }

  function findSubmit(commentEl) {
    const form = commentEl?.closest("form");
    const scope = form || document;
    const direct = scope.querySelector(
      'input[type=submit], button[type=submit], #submit, button[name*=submit i]'
    );
    if (direct && isVisible(direct)) return direct;
    const byText = [...scope.querySelectorAll("button, input[type=button], a[role=button]")].find(
      (b) => isVisible(b) && /post comment|submit|发表|提交|发布/i.test(b.textContent || b.value || "")
    );
    return byText || null;
  }

  BLF.detect = function detect(rules) {
    const overrides = applyRules(rules);
    const fields = {
      comment: overrides.comment || pick("comment", document),
      author: overrides.author || pick("author", document),
      email: overrides.email || pick("email", document),
      url: overrides.url || pick("url", document),
    };
    const captcha = CAPTCHA_PROBES.filter(([sel]) => document.querySelector(sel)).map(([, name]) => name);
    if (/just a moment|attention required/i.test(document.title)) captcha.push("Cloudflare");

    const embedded = EMBEDDED_SYSTEMS.filter(([sel]) => document.querySelector(sel)).map(([, name]) => name);
    const submit = overrides.submit || findSubmit(fields.comment);

    return {
      fields,
      submit,
      captcha,
      embedded, // 跨域 iframe 评论系统，扩展无法代填，只能提示人工处理
      classification: captcha.length
        ? "captcha"
        : fields.comment
        ? "has_form"
        : embedded.length
        ? "embedded"
        : "no_form",
    };
  };
})();
