// 任务的纯函数：创建、统计、状态流转。运行逻辑在 runner.js。

import { TASK_STATUS } from "../shared/constants.js";
import { canonicalUrl, safeHttpUrl, uid } from "../shared/util.js";

export function createTask({ name, targetUrl, anchor, identityId, templateId, urls }) {
  const cleanUrls = [...new Set(urls.map(canonicalUrl).filter(Boolean))];
  return {
    id: uid("task"),
    name: String(name || "").trim() || "Untitled",
    targetUrl: safeHttpUrl(targetUrl),
    anchor: String(anchor || "").trim(),
    identityId,
    templateId,
    urls: cleanUrls,
    cursor: 0,
    status: TASK_STATUS.IDLE,
    stats: { success: 0, pending: 0, failed: 0, skipped: 0 },
    current: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function taskStats(task) {
  const total = task.urls.length;
  return {
    total,
    success: task.stats.success,
    pending: task.stats.pending,
    failed: task.stats.failed,
    skipped: task.stats.skipped,
    remaining: Math.max(0, total - task.cursor),
  };
}

/** 不可变地替换任务列表中的一项。 */
export function patchTask(tasks, taskId, patch) {
  return tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch, updatedAt: Date.now() } : t
  );
}

export function bumpStat(task, key) {
  return {
    ...task,
    stats: { ...task.stats, [key]: (task.stats[key] || 0) + 1 },
    updatedAt: Date.now(),
  };
}

export function isFinished(task) {
  return task.cursor >= task.urls.length;
}

export function findTask(tasks, taskId) {
  return tasks.find((t) => t.id === taskId) || null;
}
