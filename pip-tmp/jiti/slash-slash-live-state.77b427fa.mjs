"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.applySlashUpdate = applySlashUpdate;exports.buildSlashInitialResult = buildSlashInitialResult;exports.clearSlashSnapshots = clearSlashSnapshots;exports.failSlashResult = failSlashResult;exports.finalizeSlashResult = finalizeSlashResult;exports.getSlashRenderableSnapshot = getSlashRenderableSnapshot;exports.resolveSlashMessageDetails = resolveSlashMessageDetails;exports.restoreSlashFinalSnapshots = restoreSlashFinalSnapshots;



var _types = await jitiImport("../shared/types.ts");






















const liveSnapshots = new Map();
const finalSnapshots = new Map();
let versionCounter = 1;

const EMPTY_MESSAGES = [];
const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  turns: 0
};

function nextVersion() {
  return versionCounter++;
}

function cloneUsage() {
  return { ...EMPTY_USAGE };
}

function createPlaceholderResult(
agent,
task,
status,
index)
{
  return {
    agent,
    task,
    exitCode: 0,
    messages: EMPTY_MESSAGES,
    usage: cloneUsage(),
    progress: {
      ...(index !== undefined ? { index } : {}),
      agent,
      status,
      task,
      recentTools: [],
      recentOutput: [],
      toolCount: 0,
      tokens: 0,
      durationMs: 0
    }
  };
}

function buildParallelInitialResult(params) {
  const tasks = params.tasks ?? [];
  return {
    content: [{ type: "text", text: tasks.map((task) => `${task.agent}: ${task.task}`).join("\n\n") }],
    details: {
      mode: "parallel",
      ...(params.context ? { context: params.context } : {}),
      results: tasks.map((task, index) => createPlaceholderResult(task.agent, task.task, "running", index)),
      progress: tasks.map((task, index) => ({
        index,
        agent: task.agent,
        status: "running",
        task: task.task,
        recentTools: [],
        recentOutput: [],
        toolCount: 0,
        tokens: 0,
        durationMs: 0
      }))
    }
  };
}

function isParallelChainStep(step) {
  return "parallel" in step && Array.isArray(step.parallel);
}

function chainStepLabel(step) {
  if (isParallelChainStep(step)) {
    return `[${step.parallel.map((entry) => entry.agent).join("+")}]`;
  }
  return step.agent;
}

function flattenChainResults(chain, fallbackTask) {
  const results = [];
  let flatIndex = 0;
  for (const step of chain) {
    if (isParallelChainStep(step)) {
      for (const task of step.parallel) {
        results.push(createPlaceholderResult(task.agent, task.task ?? fallbackTask ?? "", results.length === 0 ? "running" : "pending", flatIndex));
        flatIndex++;
      }
      continue;
    }
    results.push(createPlaceholderResult(step.agent, step.task ?? fallbackTask ?? "", results.length === 0 ? "running" : "pending", flatIndex));
    flatIndex++;
  }
  return results;
}

function buildChainInitialResult(params) {
  const chain = params.chain ?? [];
  const results = flattenChainResults(chain, params.task);
  return {
    content: [{
      type: "text",
      text: results.map((result, index) => `Step ${index + 1}: ${result.agent}\n${result.task}`).join("\n\n")
    }],
    details: {
      mode: "chain",
      ...(params.context ? { context: params.context } : {}),
      results,
      progress: results.map((result, index) => ({
        index,
        agent: result.agent,
        status: index === 0 ? "running" : "pending",
        task: result.task,
        recentTools: [],
        recentOutput: [],
        toolCount: 0,
        tokens: 0,
        durationMs: 0
      })),
      chainAgents: chain.map((step) => chainStepLabel(step)),
      totalSteps: chain.length,
      currentStepIndex: 0
    }
  };
}

function buildSingleInitialResult(params) {
  const agent = params.agent ?? "subagent";
  const task = params.task ?? "";
  return {
    content: [{ type: "text", text: task }],
    details: {
      mode: "single",
      ...(params.context ? { context: params.context } : {}),
      results: [createPlaceholderResult(agent, task, "running")],
      progress: [{
        agent,
        status: "running",
        task,
        recentTools: [],
        recentOutput: [],
        toolCount: 0,
        tokens: 0,
        durationMs: 0
      }]
    }
  };
}

function buildSlashInitialResult(requestId, params) {
  const result = (params.tasks?.length ?? 0) > 0 ?
  buildParallelInitialResult(params) :
  (params.chain?.length ?? 0) > 0 ?
  buildChainInitialResult(params) :
  buildSingleInitialResult(params);
  liveSnapshots.set(requestId, { result, version: nextVersion() });
  finalSnapshots.delete(requestId);
  return { requestId, result };
}

function cloneResultsWithProgress(
results,
progress)
{
  return results.map((result, index) => {
    const nextProgress = progress?.find((entry) => entry.index === index) ??
    progress?.[index] ??
    result.progress;
    return nextProgress ? { ...result, progress: nextProgress } : result;
  });
}

function applySlashUpdate(requestId, update) {
  const snapshot = liveSnapshots.get(requestId);
  if (!snapshot) return;
  const progress = update.progress;
  if (!progress || !snapshot.result.details) return;
  const currentStepIndex = progress.findIndex((entry) => entry.status === "running");
  const nextDetails = {
    ...snapshot.result.details,
    progress,
    results: cloneResultsWithProgress(snapshot.result.details.results, progress),
    ...(snapshot.result.details.mode === "chain" && currentStepIndex >= 0 ? { currentStepIndex } : {})
  };
  liveSnapshots.set(requestId, {
    result: {
      ...snapshot.result,
      details: nextDetails
    },
    version: nextVersion()
  });
}

function finalizeSlashResult(response) {
  const snapshot = {
    result: response.result,
    version: nextVersion()
  };
  finalSnapshots.set(response.requestId, snapshot);
  liveSnapshots.delete(response.requestId);
  return {
    requestId: response.requestId,
    result: response.result
  };
}

function failSlashResult(requestId, params, message) {
  const initial = buildSlashInitialResult(requestId, params).result;
  const failedResults = initial.details.results.map((result) => ({
    ...result,
    exitCode: 1,
    error: message,
    progress: result.progress ? { ...result.progress, status: "failed" } : result.progress
  }));
  const result = {
    content: [{ type: "text", text: message }],
    details: {
      ...initial.details,
      results: failedResults,
      progress: failedResults.map((entry) => entry.progress).filter(Boolean)
    }
  };
  const snapshot = { result, version: nextVersion() };
  finalSnapshots.set(requestId, snapshot);
  liveSnapshots.delete(requestId);
  return { requestId, result };
}

function isSlashMessageDetails(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  if (typeof v.requestId !== "string" || !v.requestId) return false;
  if (!v.result || !Array.isArray(v.result.content)) return false;
  return !!v.result.details && Array.isArray(v.result.details.results);
}

function resolveSlashMessageDetails(value) {
  return isSlashMessageDetails(value) ? value : undefined;
}

function getSlashRenderableSnapshot(details) {
  return finalSnapshots.get(details.requestId) ??
  liveSnapshots.get(details.requestId) ??
  { result: details.result, version: 0 };
}

function restoreSlashFinalSnapshots(entries) {
  liveSnapshots.clear();
  finalSnapshots.clear();
  for (const entry of entries) {
    const e = entry;
    if (e?.type !== "custom_message" || e.customType !== _types.SLASH_RESULT_TYPE) continue;
    const details = resolveSlashMessageDetails(e.details);
    if (!details) continue;
    finalSnapshots.set(details.requestId, { result: details.result, version: nextVersion() });
  }
}

function clearSlashSnapshots() {
  liveSnapshots.clear();
  finalSnapshots.clear();
} /* v9-cb517d10b1f669d4 */
