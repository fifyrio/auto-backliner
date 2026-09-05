// 环形日志缓冲。写入走 store 的串行队列，因此不会丢事件。

import { LOG_LEVEL } from "../shared/constants.js";
import { uid } from "../shared/util.js";
import { update } from "./store.js";

export function log(level, message, meta = {}) {
  return update((state) => ({
    ...state,
    logs: [
      ...state.logs,
      { id: uid("log"), ts: Date.now(), level, message, ...meta },
    ],
  }));
}

export const info = (m, meta) => log(LOG_LEVEL.INFO, m, meta);
export const warn = (m, meta) => log(LOG_LEVEL.WARN, m, meta);
export const error = (m, meta) => log(LOG_LEVEL.ERROR, m, meta);
export const success = (m, meta) => log(LOG_LEVEL.SUCCESS, m, meta);

export function clearLogs() {
  return update((state) => ({ ...state, logs: [] }));
}
