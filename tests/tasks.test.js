import test from "node:test";
import assert from "node:assert/strict";
import { bumpStat, createTask, isFinished, patchTask, taskStats } from "../src/bg/tasks.js";
import { TASK_STATUS } from "../src/shared/constants.js";

const base = () => createTask({
  name: "Canva",
  targetUrl: "https://canva.com/",
  anchor: "design",
  identityId: "i1",
  templateId: "t1",
  urls: ["https://a.com/p", "https://a.com/p#x", "https://b.com/p"],
});

test("createTask dedupes and canonicalises urls", () => {
  assert.deepEqual(base().urls, ["https://a.com/p", "https://b.com/p"]);
});

test("createTask rejects a non-http target url", () => {
  const task = createTask({ name: "x", targetUrl: "javascript:alert(1)", urls: [] });
  assert.equal(task.targetUrl, "");
});

test("taskStats derives remaining from the cursor", () => {
  const task = { ...base(), cursor: 1 };
  const stats = taskStats(task);
  assert.equal(stats.total, 2);
  assert.equal(stats.remaining, 1);
});

test("bumpStat increments without mutating the original task", () => {
  const task = base();
  const next = bumpStat(task, "success");
  assert.equal(next.stats.success, 1);
  assert.equal(task.stats.success, 0);
});

test("patchTask only touches the matching task", () => {
  const a = base();
  const b = base();
  const next = patchTask([a, b], b.id, { status: TASK_STATUS.RUNNING });
  assert.equal(next[1].status, TASK_STATUS.RUNNING);
  assert.equal(next[0].status, TASK_STATUS.IDLE);
  assert.equal(a.status, TASK_STATUS.IDLE);
});

test("isFinished is true once the cursor passes the last url", () => {
  assert.equal(isFinished({ ...base(), cursor: 2 }), true);
  assert.equal(isFinished({ ...base(), cursor: 1 }), false);
});
