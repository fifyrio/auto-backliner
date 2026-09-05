// 全局常量：状态机取值、默认配置、容量上限。
// 所有魔法数字集中在此，业务代码只引用具名常量。

export const CANDIDATE_STATUS = Object.freeze({
  NEW: "new",
  OPENED: "opened",
  HAS_FORM: "has_form",
  NO_FORM: "no_form",
  CAPTCHA: "captcha",
  FILLED: "filled",
  PENDING: "pending",
  POSTED: "posted",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const TASK_STATUS = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  DONE: "done",
  ERROR: "error",
});

export const SUBMIT_MODE = Object.freeze({
  ASSIST: "assist", // 填充后停下，等你人工检查并点提交
  AUTO: "auto", // 填充后自动点提交（需自行承担合规风险）
});

export const LOG_LEVEL = Object.freeze({
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  SUCCESS: "success",
});

export const LIMITS = Object.freeze({
  LOG_ENTRIES: 500, // 日志环形缓冲条数
  CANDIDATES: 5000, // 候选库上限，超出后拒绝新增
  API_TIMEOUT_MS: 20000,
  API_RETRIES: 2,
  PAGE_LOAD_TIMEOUT_MS: 30000,
  FILL_TIMEOUT_MS: 90000,
  KEEPALIVE_INTERVAL_MS: 20000, // MV3 service worker 心跳
});

export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: "",
  lang: "zh",
  submitMode: SUBMIT_MODE.ASSIST,
  perRootLimit: 3, // 同一根域名最多保留几个候选
  minDomainRating: 0,
  dofollowOnly: false,
  typeSpeedMs: 60, // 逐字符输入的基准间隔
  gapMinSec: 25, // 两次发布之间的最小间隔
  gapMaxSec: 70, // 最大间隔（区间内随机，避免固定节奏）
  rootCooldownMin: 30, // 同一根域名两次发布的冷却分钟数
  closeTabAfter: true,
});

export const MSG = Object.freeze({
  DISCOVER: "discover",
  ADD_CURRENT_PAGE: "addCurrentPage",
  FILL_CURRENT_PAGE: "fillCurrentPage",
  SET_CANDIDATE_STATUS: "setCandidateStatus",
  DELETE_CANDIDATES: "deleteCandidates",
  TASK_CREATE: "taskCreate",
  TASK_UPDATE: "taskUpdate",
  TASK_DELETE: "taskDelete",
  TASK_START: "taskStart",
  TASK_PAUSE: "taskPause",
  TASK_STOP: "taskStop",
  RUN_DECISION: "runDecision", // assist 模式下人工裁决当前页
  STATE_CHANGED: "stateChanged", // 后台 → 面板广播
  GET_SNAPSHOT: "getSnapshot",
  CLEAR_DATA: "clearData",
  CLEAR_LOGS: "clearLogs",
  SAVE_SETTINGS: "saveSettings",
  LIBRARY_SAVE: "librarySave",
  LIBRARY_DELETE: "libraryDelete",
});
