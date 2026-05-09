"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.checkPidLiveness = checkPidLiveness;exports.reconcileAsyncRun = reconcileAsyncRun;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));
var _atomicJson = await jitiImport("../../shared/atomic-json.ts");
var _types = await jitiImport("../../shared/types.ts");
var _parallelGroups = await jitiImport("./parallel-groups.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}

































function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isNotFoundError(error) {
  return typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";
}

function appendJsonl(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf-8");
}

function readStatusFile(asyncDir) {
  const statusPath = path.join(asyncDir, "status.json");
  let content;
  try {
    content = fs.readFileSync(statusPath, "utf-8");
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw new Error(`Failed to read async status file '${statusPath}': ${getErrorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined
    });
  }
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse async status file '${statusPath}': ${getErrorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined
    });
  }
}
















function readResultRepairData(resultPath) {
  try {
    const data = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    const state = data.success ? "complete" : data.state === "paused" || data.exitCode === 0 ? "paused" : "failed";
    return { state, ...(Array.isArray(data.results) ? { results: data.results } : {}) };
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw new Error(`Failed to read async result file '${resultPath}': ${getErrorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined
    });
  }
}

function childState(overallState, child) {
  if (child?.success === true) return "complete";
  if (child?.success === false) return "failed";
  return overallState;
}

function terminalStatusFromResult(status, resultPath, now) {
  const repair = readResultRepairData(resultPath);
  if (!repair) return undefined;
  const steps = (status.steps ?? []).map((step, index) => {
    if (step.status !== "running" && step.status !== "pending") return step;
    const child = repair.results?.[index];
    const state = childState(repair.state, child);
    return {
      ...step,
      status: state === "complete" ? "complete" : state,
      endedAt: step.endedAt ?? now,
      durationMs: step.startedAt !== undefined && step.durationMs === undefined ? Math.max(0, now - step.startedAt) : step.durationMs,
      exitCode: step.exitCode ?? (state === "complete" || state === "paused" ? 0 : 1),
      error: state === "failed" ? step.error ?? child?.error : step.error,
      sessionFile: step.sessionFile ?? child?.sessionFile,
      model: step.model ?? child?.model,
      attemptedModels: step.attemptedModels ?? child?.attemptedModels,
      modelAttempts: step.modelAttempts ?? child?.modelAttempts
    };
  });
  return {
    ...status,
    state: repair.state,
    activityState: undefined,
    lastUpdate: now,
    endedAt: status.endedAt ?? now,
    steps
  };
}

function buildStartedStatus(asyncDir, startedRun, now) {
  const startedAt = startedRun.startedAt ?? now;
  const agents = startedRun.agents?.length ? startedRun.agents : ["subagent"];
  const chainStepCount = startedRun.chainStepCount;
  const parallelGroups = chainStepCount !== undefined ?
  (0, _parallelGroups.normalizeParallelGroups)(startedRun.parallelGroups, agents.length, chainStepCount) :
  [];
  return {
    runId: startedRun.runId || path.basename(asyncDir),
    ...(startedRun.sessionId ? { sessionId: startedRun.sessionId } : {}),
    mode: startedRun.mode ?? "single",
    state: "running",
    pid: startedRun.pid,
    startedAt,
    lastUpdate: now,
    currentStep: 0,
    ...(chainStepCount !== undefined ? { chainStepCount } : {}),
    ...(parallelGroups.length ? { parallelGroups } : {}),
    steps: agents.map((agent) => ({
      agent,
      status: "running",
      startedAt
    })),
    ...(startedRun.sessionFile ? { sessionFile: startedRun.sessionFile } : {})
  };
}

function buildFailedRepair(status, asyncDir, now, reason) {
  const runId = status.runId || path.basename(asyncDir);
  const pid = typeof status.pid === "number" ? status.pid : "unknown";
  const message = reason ?? `Async runner process ${pid} exited or disappeared before writing a result. Marked run failed by stale-run reconciliation.`;
  const steps = status.steps?.length ? status.steps : [{ agent: "subagent", status: "running" }];
  const repairedSteps = steps.map((step) => step.status === "running" || step.status === "pending" ?
  {
    ...step,
    status: "failed",
    activityState: undefined,
    endedAt: step.endedAt ?? now,
    durationMs: step.startedAt !== undefined && step.durationMs === undefined ? Math.max(0, now - step.startedAt) : step.durationMs,
    exitCode: step.exitCode ?? 1,
    error: step.error ?? message
  } :
  step);
  const repairedStatus = {
    ...status,
    state: "failed",
    activityState: undefined,
    lastUpdate: now,
    endedAt: now,
    steps: repairedSteps
  };
  const resultAgent = repairedSteps[status.currentStep ?? 0]?.agent ?? repairedSteps[0]?.agent ?? "subagent";
  return {
    status: repairedStatus,
    message,
    result: {
      id: runId,
      agent: resultAgent,
      mode: status.mode,
      success: false,
      state: "failed",
      summary: message,
      results: repairedSteps.map((step) => ({
        agent: step.agent,
        output: step.status === "complete" || step.status === "completed" ? "" : message,
        error: step.status === "complete" || step.status === "completed" ? undefined : step.error ?? message,
        success: step.status === "complete" || step.status === "completed",
        model: step.model,
        attemptedModels: step.attemptedModels,
        modelAttempts: step.modelAttempts,
        sessionFile: step.sessionFile
      })),
      exitCode: 1,
      timestamp: now,
      durationMs: Math.max(0, now - status.startedAt),
      asyncDir,
      sessionId: status.sessionId,
      sessionFile: status.sessionFile
    }
  };
}

function writeFailedRepair(asyncDir, status, resultPath, now, reason) {
  const repair = buildFailedRepair(status, asyncDir, now, reason);
  (0, _atomicJson.writeAtomicJson)(resultPath, repair.result);
  (0, _atomicJson.writeAtomicJson)(path.join(asyncDir, "status.json"), repair.status);
  appendJsonl(path.join(asyncDir, "events.jsonl"), {
    type: "subagent.run.repaired_stale",
    ts: now,
    runId: repair.status.runId,
    pid: status.pid,
    resultPath,
    message: repair.message
  });
  return { status: repair.status, repaired: true, resultPath, message: repair.message };
}

function checkPidLiveness(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ?
    error.code :
    undefined;
    if (code === "ESRCH") return "dead";
    if (code === "EPERM") return "unknown";
    return "unknown";
  }
}

function reconcileAsyncRun(asyncDir, options = {}) {
  const now = options.now?.() ?? Date.now();
  const status = readStatusFile(asyncDir);
  const startedStatus = !status && options.startedRun ? buildStartedStatus(asyncDir, options.startedRun, now) : undefined;
  const effectiveStatus = status ?? startedStatus;
  if (!effectiveStatus) return { status: null, repaired: false };

  const runId = effectiveStatus.runId || path.basename(asyncDir);
  const resultPath = path.join(options.resultsDir ?? _types.RESULTS_DIR, `${runId}.json`);
  if (fs.existsSync(resultPath)) {
    const terminalStatus = effectiveStatus.state === "running" || effectiveStatus.state === "queued" ?
    terminalStatusFromResult(effectiveStatus, resultPath, now) :
    undefined;
    if (terminalStatus) {
      (0, _atomicJson.writeAtomicJson)(path.join(asyncDir, "status.json"), terminalStatus);
      return { status: terminalStatus, repaired: true, resultPath, message: "Existing async result file was used to repair stale running status." };
    }
    return { status: effectiveStatus, repaired: false, resultPath };
  }

  if (effectiveStatus.state !== "running" || typeof effectiveStatus.pid !== "number") {
    return { status: status ?? null, repaired: false, resultPath };
  }

  if (!status) {
    const startedAt = options.startedRun?.startedAt ?? effectiveStatus.startedAt;
    if (now - startedAt < (options.missingStatusGraceMs ?? 1000)) {
      return { status: null, repaired: false, resultPath };
    }
  }

  const liveness = checkPidLiveness(effectiveStatus.pid, options.kill);
  if (liveness !== "dead") {
    const staleAfterMs = options.staleAlivePidMs ?? 24 * 60 * 60 * 1000;
    const lastUpdate = effectiveStatus.lastUpdate ?? effectiveStatus.startedAt;
    if (now - lastUpdate <= staleAfterMs) return { status: status ?? null, repaired: false, resultPath };
    const message = `Async runner process ${effectiveStatus.pid} still has a live PID, but status has not updated for ${now - lastUpdate}ms. Marked run failed by stale-run reconciliation because PID ownership cannot be verified.`;
    return writeFailedRepair(asyncDir, effectiveStatus, resultPath, now, message);
  }

  return writeFailedRepair(asyncDir, effectiveStatus, resultPath, now);
} /* v9-0a417b7586570d91 */
