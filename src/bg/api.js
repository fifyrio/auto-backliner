// GoAnyAPI Backlinks 客户端。
// v1 直接 fetch，没有超时也没有重试：网络抖一下整轮发现就废了。
// 这里加超时中断 + 指数退避重试（只对 5xx / 网络错误重试，4xx 立即失败，
// 因为失败请求不扣积分，但重试 4xx 只是浪费时间）。

import { LIMITS } from "../shared/constants.js";
import { cleanDomain, sleep } from "../shared/util.js";

const API_ENDPOINT = "https://api.goanyapi.com/api/v1/backlink";

class ApiError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

async function requestOnce(domain, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.API_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API_ENDPOINT}?domain=${encodeURIComponent(domain)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    let json = null;
    try {
      json = await resp.json();
    } catch {
      throw new ApiError(`API 返回非 JSON (HTTP ${resp.status})`, {
        status: resp.status,
        retryable: resp.status >= 500,
      });
    }

    if (!resp.ok) {
      throw new ApiError(json?.message || `HTTP ${resp.status}`, {
        status: resp.status,
        retryable: resp.status >= 500 || resp.status === 429,
      });
    }
    if (json.code && json.code !== "ok" && json.code !== 0) {
      throw new ApiError(json.message || `业务错误 code=${json.code}`, { status: resp.status });
    }
    return json.data || {};
  } catch (e) {
    if (e.name === "AbortError") {
      throw new ApiError(`请求超时 (${LIMITS.API_TIMEOUT_MS / 1000}s)`, { retryable: true });
    }
    if (e instanceof ApiError) throw e;
    throw new ApiError(e.message || String(e), { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

export async function queryBacklinks(rawDomain, apiKey) {
  if (!apiKey) throw new ApiError("未配置 API Key");
  const domain = cleanDomain(rawDomain);
  if (!domain) throw new ApiError("域名为空");

  let lastError;
  for (let attempt = 0; attempt <= LIMITS.API_RETRIES; attempt += 1) {
    try {
      return await requestOnce(domain, apiKey);
    } catch (e) {
      lastError = e;
      if (!e.retryable || attempt === LIMITS.API_RETRIES) break;
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastError;
}
