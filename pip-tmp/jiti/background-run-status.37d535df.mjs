"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.inspectSubagentStatus = inspectSubagentStatus;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));

var _asyncStatus = await jitiImport("./async-status.ts");
var _statusFormat = await jitiImport("../../shared/status-format.ts");
var _types = await jitiImport("../../shared/types.ts");
var _intercomBridge = await jitiImport("../../intercom/intercom-bridge.ts");
var _asyncResume = await jitiImport("./async-resume.ts");
var _parallelGroups = await jitiImport("./parallel-groups.ts");
var _staleRunReconciler = await jitiImport("./stale-run-reconciler.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}















function hasExistingSessionFile(value) {
  return typeof value === "string" && fs.existsSync(value);
}

function formatResumeGuidance(runId, children, fallbackSessionFile) {
  const knownChildren = children.
  map((child, index) => ({ child, index })).
  filter(({ child }) => typeof child.agent === "string");
  if (!runId || knownChildren.length === 0) return "Resume: unavailable; no child session file was persisted.";
  const singleSessionFile = knownChildren[0]?.child.sessionFile ?? fallbackSessionFile;
  if (children.length === 1 && knownChildren.length === 1 && hasExistingSessionFile(singleSessionFile)) {
    return `Revive: subagent({ action: "resume", id: "${runId}", message: "..." })`;
  }
  const childWithSession = knownChildren.find(({ child }) => hasExistingSessionFile(child.sessionFile));
  if (childWithSession) {
    return `Revive child: subagent({ action: "resume", id: "${runId}", index: ${childWithSession.index}, message: "..." })`;
  }
  return "Resume: unavailable; no child session file was persisted.";
}

function stepLineLabel(status, index) {
  const steps = status.steps ?? [];
  if (status.mode === "parallel") return `Agent ${index + 1}/${steps.length || 1}`;
  if (status.mode === "chain") {
    const chainStepCount = status.chainStepCount ?? (steps.length || 1);
    const groups = (0, _parallelGroups.normalizeParallelGroups)(status.parallelGroups, steps.length, chainStepCount);
    const group = groups.find((candidate) => index >= candidate.start && index < candidate.start + candidate.count);
    if (group) return `Step ${group.stepIndex + 1}/${chainStepCount} Agent ${index - group.start + 1}/${group.count}`;
    return `Step ${(0, _parallelGroups.flatToLogicalStepIndex)(index, chainStepCount, groups) + 1}/${chainStepCount}`;
  }
  return `Step ${index + 1}`;
}

function inspectSubagentStatus(params, deps = {}) {
  const asyncDirRoot = deps.asyncDirRoot ?? _types.ASYNC_DIR;
  const resultsDir = deps.resultsDir ?? _types.RESULTS_DIR;
  if (!params.id && !params.runId && !params.dir) {
    try {
      const runs = (0, _asyncStatus.listAsyncRuns)(asyncDirRoot, { states: ["queued", "running"], resultsDir, kill: deps.kill, now: deps.now });
      return {
        content: [{ type: "text", text: (0, _asyncStatus.formatAsyncRunList)(runs) }],
        details: { mode: "single", results: [] }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
        details: { mode: "single", results: [] }
      };
    }
  }

  let location;
  try {
    location = (0, _asyncResume.resolveAsyncRunLocation)(params, asyncDirRoot, resultsDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
      details: { mode: "single", results: [] }
    };
  }
  const { asyncDir, resultPath, resolvedId } = location;

  if (!asyncDir && !resultPath) {
    return {
      content: [{ type: "text", text: "Async run not found. Provide id or dir." }],
      isError: true,
      details: { mode: "single", results: [] }
    };
  }

  if (asyncDir) {
    let reconciliation;
    try {
      reconciliation = (0, _staleRunReconciler.reconcileAsyncRun)(asyncDir, { resultsDir, kill: deps.kill, now: deps.now });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
        details: { mode: "single", results: [] }
      };
    }
    const status = reconciliation.status;
    const effectiveRunId = status?.runId ?? resolvedId ?? "unknown";
    const logPath = path.join(asyncDir, `subagent-log-${effectiveRunId}.md`);
    const eventsPath = path.join(asyncDir, "events.jsonl");
    if (status) {
      const outputPath = (0, _asyncStatus.formatAsyncRunOutputPath)({ asyncDir, outputFile: status.outputFile });
      const progressLabel = (0, _asyncStatus.formatAsyncRunProgressLabel)({
        mode: status.mode,
        state: status.state,
        currentStep: status.currentStep,
        chainStepCount: status.chainStepCount,
        parallelGroups: status.parallelGroups,
        steps: (status.steps ?? []).map((step, index) => ({ index, agent: step.agent, status: step.status }))
      });
      const started = new Date(status.startedAt).toISOString();
      const updated = status.lastUpdate ? new Date(status.lastUpdate).toISOString() : "n/a";
      const statusActivityText = status.state === "running" ? (0, _statusFormat.formatActivityLabel)(status.lastActivityAt, status.activityState) : undefined;

      const lines = [
      `Run: ${status.runId}`,
      `State: ${status.state}`,
      statusActivityText ? `Activity: ${statusActivityText}` : undefined,
      `Mode: ${status.mode}`,
      `Progress: ${progressLabel}`,
      `Started: ${started}`,
      `Updated: ${updated}`,
      `Dir: ${asyncDir}`,
      outputPath ? `Output: ${outputPath}` : undefined,
      reconciliation.message ? `Diagnosis: ${reconciliation.message}` : undefined,
      reconciliation.resultPath && fs.existsSync(reconciliation.resultPath) ? `Result: ${reconciliation.resultPath}` : undefined].
      filter((line) => Boolean(line));
      for (const [index, step] of (status.steps ?? []).entries()) {
        const stepActivityText = step.status === "running" ? (0, _statusFormat.formatActivityLabel)(step.lastActivityAt, step.activityState) : undefined;
        const errorText = step.error ? `, error: ${step.error}` : "";
        lines.push(`${stepLineLabel(status, index)}: ${step.agent} ${step.status}${stepActivityText ? `, ${stepActivityText}` : ""}${errorText}`);
        const stepOutputPath = path.join(asyncDir, `output-${index}.log`);
        if (stepOutputPath !== outputPath && fs.existsSync(stepOutputPath)) lines.push(`  Output: ${stepOutputPath}`);
        if (step.status === "running") {
          lines.push(`  Intercom target: ${(0, _intercomBridge.resolveSubagentIntercomTarget)(status.runId, step.agent, index)} (if registered)`);
        }
      }
      if (status.sessionFile) lines.push(`Session: ${status.sessionFile}`);
      if (status.state !== "running") {
        lines.push(formatResumeGuidance(status.runId, status.steps ?? [], status.sessionFile));
      }
      if (fs.existsSync(logPath)) lines.push(`Log: ${logPath}`);
      if (fs.existsSync(eventsPath)) lines.push(`Events: ${eventsPath}`);

      return { content: [{ type: "text", text: lines.join("\n") }], details: { mode: "single", results: [] } };
    }
  }

  if (resultPath) {
    try {
      const raw = fs.readFileSync(resultPath, "utf-8");
      const data = JSON.parse(raw);
      const status = data.success ? "complete" : data.state === "paused" || data.exitCode === 0 ? "paused" : "failed";
      const runId = data.runId ?? data.id ?? resolvedId;
      const lines = [`Run: ${runId}`, `State: ${status}`, `Result: ${resultPath}`];
      const children = Array.isArray(data.results) ? data.results : data.agent ? [{ agent: data.agent, sessionFile: data.sessionFile }] : [];
      lines.push(formatResumeGuidance(runId, children, data.sessionFile));
      if (data.summary) lines.push("", data.summary);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { mode: "single", results: [] } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to read async result file: ${message}` }],
        isError: true,
        details: { mode: "single", results: [] }
      };
    }
  }

  return {
    content: [{ type: "text", text: "Status file not found." }],
    isError: true,
    details: { mode: "single", results: [] }
  };
} /* v9-502343157cae842f */
