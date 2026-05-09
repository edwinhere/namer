"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.createSubagentExecutor = createSubagentExecutor;var _nodeCrypto = await jitiImport("node:crypto");
var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));



var _artifacts = await jitiImport("../../shared/artifacts.ts");
var _chainClarify = await jitiImport("./chain-clarify.ts");
var _modelInfo = await jitiImport("../../shared/model-info.ts");
var _chainExecution = await jitiImport("./chain-execution.ts");
var _agentScope = await jitiImport("../../agents/agent-scope.ts");
var _agentManagement = await jitiImport("../../agents/agent-management.ts");
var _doctor = await jitiImport("../../extension/doctor.ts");
var _controlNotices = await jitiImport("../../extension/control-notices.ts");
var _execution = await jitiImport("./execution.ts");
var _modelFallback = await jitiImport("../shared/model-fallback.ts");
var _parallelUtils = await jitiImport("../shared/parallel-utils.ts");
var _runHistory = await jitiImport("../shared/run-history.ts");
var _settings = await jitiImport("../../shared/settings.ts");












var _skills = await jitiImport("../../agents/skills.ts");
var _asyncExecution = await jitiImport("../background/async-execution.ts");
var _forkContext = await jitiImport("../../shared/fork-context.ts");
var _sessionIdentity = await jitiImport("../../shared/session-identity.ts");
var _intercomBridge = await jitiImport("../../intercom/intercom-bridge.ts");
var _subagentControl = await jitiImport("../shared/subagent-control.ts");
var _singleOutput = await jitiImport("../shared/single-output.ts");
var _utils = await jitiImport("../../shared/utils.ts");
var _resultIntercom = await jitiImport("../../intercom/result-intercom.ts");







var _asyncResume = await jitiImport("../background/async-resume.ts");
var _runStatus = await jitiImport("../background/run-status.ts");
var _topLevelAsync = await jitiImport("../background/top-level-async.ts");
var _worktree = await jitiImport("../shared/worktree.ts");








var _types = await jitiImport("../../shared/types.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}

























const ASYNC_INTERRUPT_SIGNAL = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";












































































function resolveRequestedCwd(runtimeCwd, requestedCwd) {
  return requestedCwd ? path.resolve(runtimeCwd, requestedCwd) : runtimeCwd;
}

function getForegroundControl(state, runId) {
  if (runId) return state.foregroundControls.get(runId);
  if (state.lastForegroundControlId) {
    const latest = state.foregroundControls.get(state.lastForegroundControlId);
    if (latest) return latest;
  }
  let newest;
  for (const control of state.foregroundControls.values()) {
    if (!newest || control.updatedAt > newest.updatedAt) newest = control;
  }
  return newest;
}

function formatForegroundActivity(control) {
  const facts = [];
  if (control.currentTool && control.currentToolStartedAt) facts.push(`tool ${control.currentTool} for ${Math.floor(Math.max(0, Date.now() - control.currentToolStartedAt) / 1000)}s`);else
  if (control.currentTool) facts.push(`tool ${control.currentTool}`);
  if (control.currentPath) facts.push(`path ${control.currentPath}`);
  if (control.turnCount !== undefined) facts.push(`${control.turnCount} turns`);
  if (control.tokens !== undefined) facts.push(`${control.tokens} tokens`);
  if (control.toolCount !== undefined) facts.push(`${control.toolCount} tools`);
  if (!control.lastActivityAt) {
    if (control.currentActivityState === "needs_attention") return ["needs attention", ...facts].join(" | ");
    if (control.currentActivityState === "active_long_running") return ["active but long-running", ...facts].join(" | ");
    return facts.length ? facts.join(" | ") : undefined;
  }
  const seconds = Math.floor(Math.max(0, Date.now() - control.lastActivityAt) / 1000);
  if (control.currentActivityState === "needs_attention") return [`no activity for ${seconds}s`, ...facts].join(" | ");
  if (control.currentActivityState === "active_long_running") return [`active but long-running; last activity ${seconds}s ago`, ...facts].join(" | ");
  return [`active ${seconds}s ago`, ...facts].join(" | ");
}

function foregroundStatusResult(control) {
  const activity = formatForegroundActivity(control);
  const lines = [
  `Run: ${control.runId}`,
  "State: running",
  `Mode: ${control.mode}`,
  control.currentAgent ? `Current: ${control.currentAgent}${control.currentIndex !== undefined ? ` step ${control.currentIndex + 1}` : ""}` : undefined,
  activity ? `Activity: ${activity}` : undefined].
  filter((line) => Boolean(line));
  return { content: [{ type: "text", text: lines.join("\n") }], details: { mode: "management", results: [] } };
}

function rememberForegroundRun(state, input) {
  state.foregroundRuns ??= new Map();
  state.foregroundRuns.set(input.runId, {
    runId: input.runId,
    mode: input.mode,
    cwd: input.cwd,
    updatedAt: Date.now(),
    children: input.results.map((result, index) => ({
      agent: result.agent,
      index,
      status: (0, _resultIntercom.resolveSubagentResultStatus)({ exitCode: result.exitCode, interrupted: result.interrupted, detached: result.detached }),
      ...(result.sessionFile ? { sessionFile: result.sessionFile } : {})
    }))
  });
  while (state.foregroundRuns.size > 50) {
    const oldest = [...state.foregroundRuns.values()].sort((left, right) => left.updatedAt - right.updatedAt)[0];
    if (!oldest) break;
    state.foregroundRuns.delete(oldest.runId);
  }
}

function resolveForegroundResumeTarget(params, state) {
  const requested = (params.id ?? params.runId)?.trim();
  if (!requested || !state.foregroundRuns?.size) return undefined;
  const direct = state.foregroundRuns.get(requested);
  const matches = direct ? [direct] : [...state.foregroundRuns.values()].filter((run) => run.runId.startsWith(requested));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) throw new Error(`Ambiguous foreground run id prefix '${requested}' matched: ${matches.map((run) => run.runId).join(", ")}. Provide a longer id.`);
  const run = matches[0];
  if (run.children.length > 1 && params.index === undefined) throw new Error(`Foreground run '${run.runId}' has ${run.children.length} children. Provide index to choose one.`);
  const index = params.index ?? 0;
  if (!Number.isInteger(index)) throw new Error(`Foreground run '${run.runId}' index must be an integer.`);
  if (index < 0 || index >= run.children.length) throw new Error(`Foreground run '${run.runId}' has ${run.children.length} children. Index ${index} is out of range.`);
  const child = run.children[index];
  if (child.status === "detached") throw new Error(`Foreground run '${run.runId}' child ${index} is detached for intercom coordination and cannot be revived safely from the remembered foreground state. Reply to the supervisor request first; after the child exits, start a fresh follow-up if needed.`);
  if (!child.sessionFile) throw new Error(`Foreground run '${run.runId}' child ${index} does not have a persisted session file to resume from.`);
  if (path.extname(child.sessionFile) !== ".jsonl") throw new Error(`Foreground run '${run.runId}' child ${index} session file must be a .jsonl file: ${child.sessionFile}`);
  const sessionFile = path.resolve(child.sessionFile);
  if (!fs.existsSync(sessionFile)) throw new Error(`Foreground run '${run.runId}' child ${index} session file does not exist: ${child.sessionFile}`);
  return { runId: run.runId, mode: run.mode, state: "complete", agent: child.agent, index, intercomTarget: (0, _intercomBridge.resolveSubagentIntercomTarget)(run.runId, child.agent, index), cwd: run.cwd, sessionFile };
}





function isAsyncRunNotFound(error) {
  return error instanceof Error && error.message.startsWith("Async run not found.");
}

function isResumeAmbiguity(error) {
  return error instanceof Error && /Ambiguous .*run id prefix/.test(error.message);
}

function resumeTargetExact(target, requested) {
  return target?.runId === requested;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExactResumeError(error, source, requested) {
  if (!(error instanceof Error) || !requested) return false;
  return new RegExp(`\\b${source} run '${escapeRegExp(requested)}'`, "i").test(error.message);
}

function resolveResumeTarget(params, state) {
  const requested = (params.id ?? params.runId)?.trim() ?? "";
  let foregroundTarget;
  let foregroundError;
  let asyncTarget;
  let asyncError;

  try {
    const target = resolveForegroundResumeTarget(params, state);
    if (target) foregroundTarget = { kind: "revive", source: "foreground", ...target };
  } catch (error) {
    foregroundError = error;
  }
  try {
    asyncTarget = { source: "async", ...(0, _asyncResume.resolveAsyncResumeTarget)(params) };
  } catch (error) {
    asyncError = error;
  }

  if (foregroundTarget && asyncTarget) {
    const foregroundExact = resumeTargetExact(foregroundTarget, requested);
    const asyncExact = resumeTargetExact(asyncTarget, requested);
    if (foregroundExact && !asyncExact) return foregroundTarget;
    if (asyncExact && !foregroundExact) return asyncTarget;
    throw new Error(`Resume id '${requested}' is ambiguous between foreground run '${foregroundTarget.runId}' and async run '${asyncTarget.runId}'. Provide a full run id.`);
  }
  if (foregroundTarget) {
    if (isExactResumeError(asyncError, "async", requested)) throw asyncError;
    if (isResumeAmbiguity(asyncError) && !resumeTargetExact(foregroundTarget, requested)) throw asyncError;
    return foregroundTarget;
  }
  if (asyncTarget) {
    if (isExactResumeError(foregroundError, "foreground", requested)) throw foregroundError;
    if (isResumeAmbiguity(foregroundError) && !resumeTargetExact(asyncTarget, requested)) throw foregroundError;
    return asyncTarget;
  }
  if (foregroundError && !isAsyncRunNotFound(asyncError)) throw foregroundError;
  if (foregroundError) throw foregroundError;
  if (asyncError) throw asyncError;
  throw new Error("Run not found. Provide id or runId.");
}

function getAsyncInterruptTarget(state, runId) {
  if (runId) {
    const direct = state.asyncJobs.get(runId);
    if (direct) return { asyncId: direct.asyncId, asyncDir: direct.asyncDir };
  }
  let newest;
  for (const job of state.asyncJobs.values()) {
    if (job.status !== "running") continue;
    if (!newest || (job.updatedAt ?? 0) > newest.updatedAt) {
      newest = { asyncId: job.asyncId, asyncDir: job.asyncDir, updatedAt: job.updatedAt ?? 0 };
    }
  }
  return newest ? { asyncId: newest.asyncId, asyncDir: newest.asyncDir } : undefined;
}

function emitControlNotification(input)




{
  if (!(0, _subagentControl.shouldNotifyControlEvent)(input.controlConfig, input.event)) return;
  const childIntercomTarget = input.intercomBridge.active ?
  (0, _intercomBridge.resolveSubagentIntercomTarget)(input.event.runId, input.event.agent, input.event.index) :
  undefined;
  const payload = {
    event: input.event,
    source: "foreground",
    childIntercomTarget,
    noticeText: (0, _subagentControl.formatControlNoticeMessage)(input.event, childIntercomTarget)
  };
  if (input.controlConfig.notifyChannels.includes("event")) {
    input.pi.events.emit(_types.SUBAGENT_CONTROL_EVENT, payload);
  }
  if (input.event.type !== "active_long_running" && input.controlConfig.notifyChannels.includes("intercom") && input.intercomBridge.active && input.intercomBridge.orchestratorTarget) {
    input.pi.events.emit(_types.SUBAGENT_CONTROL_INTERCOM_EVENT, {
      ...payload,
      to: input.intercomBridge.orchestratorTarget,
      message: (0, _subagentControl.formatControlIntercomMessage)(input.event, childIntercomTarget)
    });
  }
}

function interruptAsyncRun(state, runId) {
  const target = getAsyncInterruptTarget(state, runId);
  if (!target) return null;
  const status = (0, _utils.readStatus)(target.asyncDir);
  if (!status || status.state !== "running" || typeof status.pid !== "number") {
    return {
      content: [{ type: "text", text: `No running async run with an interrupt-capable pid was found for '${runId ?? "current"}'.` }],
      isError: true,
      details: { mode: "management", results: [] }
    };
  }
  try {
    process.kill(status.pid, ASYNC_INTERRUPT_SIGNAL);
    const tracked = state.asyncJobs.get(target.asyncId);
    if (tracked) {
      tracked.activityState = undefined;
      tracked.updatedAt = Date.now();
    }
    return {
      content: [{ type: "text", text: `Interrupt requested for async run ${target.asyncId}.` }],
      details: { mode: "management", results: [] }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to interrupt async run ${target.asyncId}: ${message}` }],
      isError: true,
      details: { mode: "management", results: [] }
    };
  }
}

async function resumeAsyncRun(input)




{
  const followUp = (input.params.message ?? input.params.task ?? "").trim();
  if (!followUp) {
    return {
      content: [{ type: "text", text: "action='resume' requires message." }],
      isError: true,
      details: { mode: "management", results: [] }
    };
  }

  let target;
  try {
    target = resolveResumeTarget(input.params, input.deps.state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: message }], isError: true, details: { mode: "management", results: [] } };
  }

  if (target.kind === "live") {
    const delivered = await (0, _resultIntercom.deliverSubagentIntercomMessageEvent)(
      input.deps.pi.events,
      target.intercomTarget,
      `Follow-up for async run ${target.runId} (${target.agent}):\n\n${followUp}`,
      500,
      { source: "async-resume", runId: target.runId, agent: target.agent, index: target.index }
    );
    if (delivered) {
      return {
        content: [{ type: "text", text: [`Delivered follow-up to live async child.`, `Run: ${target.runId}`, `Intercom target: ${target.intercomTarget}`].join("\n") }],
        details: { mode: "management", results: [] }
      };
    }
    return {
      content: [{ type: "text", text: [`Async child appears live but its intercom target is not registered.`, `Run: ${target.runId}`, `Intercom target: ${target.intercomTarget}`, `Wait for completion, then retry action='resume'.`].join("\n") }],
      isError: true,
      details: { mode: "management", results: [] }
    };
  }

  const { blocked, depth, maxDepth } = (0, _types.checkSubagentDepth)(input.deps.config.maxSubagentDepth);
  if (blocked) {
    return {
      content: [{ type: "text", text: `Nested subagent resume blocked (depth=${depth}, max=${maxDepth}). Complete the follow-up directly instead.` }],
      isError: true,
      details: { mode: "management", results: [] }
    };
  }

  const parentSessionFile = input.ctx.sessionManager.getSessionFile() ?? null;
  input.deps.state.currentSessionId = (0, _sessionIdentity.resolveCurrentSessionId)(input.ctx.sessionManager);
  const effectiveCwd = target.cwd ?? input.requestCwd;
  const scope = (0, _agentScope.resolveExecutionAgentScope)(input.params.agentScope);
  const discoveredAgents = input.deps.discoverAgents(effectiveCwd, scope).agents;
  const sessionName = (0, _intercomBridge.resolveIntercomSessionTarget)(input.deps.pi.getSessionName(), input.ctx.sessionManager.getSessionId());
  const intercomBridge = (0, _intercomBridge.resolveIntercomBridge)({
    config: input.deps.config.intercomBridge,
    context: input.params.context,
    orchestratorTarget: sessionName,
    cwd: effectiveCwd
  });
  const agents = intercomBridge.active ?
  discoveredAgents.map((agent) => (0, _intercomBridge.applyIntercomBridgeToAgent)(agent, intercomBridge)) :
  discoveredAgents;
  const agentConfig = agents.find((agent) => agent.name === target.agent);
  if (!agentConfig) {
    return {
      content: [{ type: "text", text: `Unknown agent for resume: ${target.agent}` }],
      isError: true,
      details: { mode: "management", results: [] }
    };
  }

  const runId = (0, _nodeCrypto.randomUUID)().slice(0, 8);
  const artifactConfig = { ..._types.DEFAULT_ARTIFACT_CONFIG, enabled: input.params.artifacts !== false };
  const availableModels = input.ctx.modelRegistry.getAvailable().map(_modelInfo.toModelInfo);
  const result = (0, _asyncExecution.executeAsyncSingle)(runId, {
    agent: target.agent,
    task: (0, _asyncResume.buildRevivedAsyncTask)(target, followUp),
    agentConfig,
    ctx: {
      pi: input.deps.pi,
      cwd: input.requestCwd,
      currentSessionId: input.deps.state.currentSessionId,
      currentModelProvider: input.ctx.model?.provider
    },
    cwd: effectiveCwd,
    maxOutput: input.params.maxOutput,
    artifactsDir: input.deps.tempArtifactsDir,
    artifactConfig,
    shareEnabled: input.params.share === true,
    sessionRoot: input.deps.getSubagentSessionRoot(parentSessionFile),
    sessionFile: target.sessionFile,
    maxSubagentDepth: (0, _types.resolveCurrentMaxSubagentDepth)(input.deps.config.maxSubagentDepth),
    worktreeSetupHook: input.deps.config.worktreeSetupHook,
    worktreeSetupHookTimeoutMs: input.deps.config.worktreeSetupHookTimeoutMs,
    controlConfig: (0, _subagentControl.resolveControlConfig)(input.deps.config.control, input.params.control),
    controlIntercomTarget: intercomBridge.active ? intercomBridge.orchestratorTarget : undefined,
    childIntercomTarget: intercomBridge.active ? (agent, index) => (0, _intercomBridge.resolveSubagentIntercomTarget)(runId, agent, index) : undefined,
    availableModels
  });
  if (result.isError) return result;

  const revivedId = result.details.asyncId ?? runId;
  const revivedTarget = intercomBridge.active ? (0, _intercomBridge.resolveSubagentIntercomTarget)(revivedId, target.agent, 0) : undefined;
  const sourceLabel = target.source === "foreground" ? "foreground" : "async";
  const lines = [
  `Revived ${sourceLabel} subagent from ${target.runId}.`,
  `Revived run: ${revivedId}`,
  `Agent: ${target.agent}`,
  `Session: ${target.sessionFile}`,
  result.details.asyncDir ? `Async dir: ${result.details.asyncDir}` : undefined,
  revivedTarget ? `Intercom target: ${revivedTarget} (if registered)` : undefined,
  `Status if needed: subagent({ action: "status", id: "${revivedId}" })`].
  filter((line) => Boolean(line));
  return { content: [{ type: "text", text: (0, _asyncExecution.formatAsyncStartedMessage)(lines.join("\n")) }], details: result.details };
}

function resultSummaryForIntercom(result) {
  const output = (0, _utils.getSingleResultOutput)(result);
  if (result.exitCode !== 0 && result.error) {
    return output ? `${result.error}\n\nOutput:\n${output}` : result.error;
  }
  return output || result.error || "(no output)";
}

function createForegroundControlNotifier(data, deps) {
  return (event) => emitControlNotification({
    pi: deps.pi,
    controlConfig: data.controlConfig,
    intercomBridge: data.intercomBridge,
    event
  });
}

async function emitForegroundResultIntercom(input)






{
  if (!input.intercomBridge.active || !input.intercomBridge.orchestratorTarget) return null;
  const children = input.results.flatMap((result, index) => result.detached ? [] : [{
    agent: result.agent,
    status: (0, _resultIntercom.resolveSubagentResultStatus)({
      exitCode: result.exitCode,
      interrupted: result.interrupted,
      detached: result.detached
    }),
    summary: resultSummaryForIntercom(result),
    index,
    artifactPath: result.artifactPaths?.outputPath,
    sessionPath: result.sessionFile,
    intercomTarget: (0, _intercomBridge.resolveSubagentIntercomTarget)(input.runId, result.agent, index)
  }]);
  if (children.length === 0) return null;
  const payload = (0, _resultIntercom.buildSubagentResultIntercomPayload)({
    to: input.intercomBridge.orchestratorTarget,
    runId: input.runId,
    mode: input.mode,
    source: "foreground",
    children,
    ...(typeof input.chainSteps === "number" ? { chainSteps: input.chainSteps } : {})
  });
  const delivered = await (0, _resultIntercom.deliverSubagentResultIntercomEvent)(input.pi.events, payload);
  if (!delivered) return null;
  return payload;
}

async function maybeBuildForegroundIntercomReceipt(input)





{
  const payload = await emitForegroundResultIntercom({
    pi: input.pi,
    intercomBridge: input.intercomBridge,
    runId: input.runId,
    mode: input.mode,
    results: input.details.results,
    ...(typeof input.details.totalSteps === "number" ? { chainSteps: input.details.totalSteps } : {})
  });
  if (!payload) return null;
  return {
    text: (0, _resultIntercom.formatSubagentResultReceipt)({ mode: input.mode, runId: input.runId, payload }),
    details: (0, _resultIntercom.stripDetailsOutputsForIntercomReceipt)(input.details)
  };
}

function validateExecutionInput(
params,
agents,
hasChain,
hasTasks,
hasSingle,
allowClarifyTaskPrompt)
{
  if (Number(hasChain) + Number(hasTasks) + Number(hasSingle) !== 1) {
    return {
      content: [
      {
        type: "text",
        text: `Provide exactly one mode. Agents: ${agents.map((a) => a.name).join(", ") || "none"}`
      }],

      isError: true,
      details: { mode: "single", results: [] }
    };
  }

  if (hasSingle && params.agent && !agents.find((agent) => agent.name === params.agent)) {
    return {
      content: [{ type: "text", text: `Unknown agent: ${params.agent}` }],
      isError: true,
      details: { mode: "single", results: [] }
    };
  }

  if (hasTasks && params.tasks) {
    for (let i = 0; i < params.tasks.length; i++) {
      const task = params.tasks[i];
      if (!agents.find((agent) => agent.name === task.agent)) {
        return {
          content: [{ type: "text", text: `Unknown agent: ${task.agent} (task ${i + 1})` }],
          isError: true,
          details: { mode: "parallel", results: [] }
        };
      }
    }
  }

  if (hasChain && params.chain) {
    if (params.chain.length === 0) {
      return {
        content: [{ type: "text", text: "Chain must have at least one step" }],
        isError: true,
        details: { mode: "chain", results: [] }
      };
    }
    const firstStep = params.chain[0];
    if ((0, _settings.isParallelStep)(firstStep)) {
      const missingTaskIndex = firstStep.parallel.findIndex((t) => !t.task);
      if (missingTaskIndex !== -1) {
        return {
          content: [{ type: "text", text: `First parallel step: task ${missingTaskIndex + 1} must have a task (no previous output to reference)` }],
          isError: true,
          details: { mode: "chain", results: [] }
        };
      }
    } else if (!firstStep.task && !params.task && !allowClarifyTaskPrompt) {
      return {
        content: [{ type: "text", text: "First step in chain must have a task" }],
        isError: true,
        details: { mode: "chain", results: [] }
      };
    }
    for (let i = 0; i < params.chain.length; i++) {
      const step = params.chain[i];
      const stepAgents = (0, _settings.getStepAgents)(step);
      for (const agentName of stepAgents) {
        if (!agents.find((a) => a.name === agentName)) {
          return {
            content: [{ type: "text", text: `Unknown agent: ${agentName} (step ${i + 1})` }],
            isError: true,
            details: { mode: "chain", results: [] }
          };
        }
      }
      if ((0, _settings.isParallelStep)(step) && step.parallel.length === 0) {
        return {
          content: [{ type: "text", text: `Parallel step ${i + 1} must have at least one task` }],
          isError: true,
          details: { mode: "chain", results: [] }
        };
      }
    }
  }

  return null;
}

function getRequestedModeLabel(params) {
  if ((params.chain?.length ?? 0) > 0) return "chain";
  if ((params.tasks?.length ?? 0) > 0) return "parallel";
  if (params.agent) return "single";
  return "single";
}

function applyAgentDefaultContext(params, agents) {
  if (params.context !== undefined) return params;
  const byName = new Map(agents.map((agent) => [agent.name, agent]));
  const names = [];
  if (params.agent) names.push(params.agent);
  for (const task of params.tasks ?? []) names.push(task.agent);
  for (const step of params.chain ?? []) names.push(...(0, _settings.getStepAgents)(step));
  return names.some((name) => byName.get(name)?.defaultContext === "fork") ?
  { ...params, context: "fork" } :
  params;
}

function buildRequestedModeError(params, message) {
  return withForkContext(
    {
      content: [{ type: "text", text: message }],
      isError: true,
      details: { mode: getRequestedModeLabel(params), results: [] }
    },
    params.context
  );
}

function expandTopLevelTaskCounts(tasks) {
  const expanded = [];
  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex];
    const rawCount = task.count;
    if (rawCount !== undefined && (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 1)) {
      return { error: `tasks[${taskIndex}].count must be an integer >= 1` };
    }
    const { count, ...concreteTask } = task;
    for (let repeat = 0; repeat < (rawCount ?? 1); repeat++) {
      expanded.push({ ...concreteTask });
    }
  }
  return { tasks: expanded };
}

function expandChainParallelCounts(chain) {
  const expandedChain = [];
  for (let stepIndex = 0; stepIndex < chain.length; stepIndex++) {
    const step = chain[stepIndex];
    if (!(0, _settings.isParallelStep)(step)) {
      expandedChain.push(step);
      continue;
    }
    const expandedParallel = [];
    for (let taskIndex = 0; taskIndex < step.parallel.length; taskIndex++) {
      const task = step.parallel[taskIndex];
      const rawCount = task.count;
      if (rawCount !== undefined && (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 1)) {
        return { error: `chain[${stepIndex}].parallel[${taskIndex}].count must be an integer >= 1` };
      }
      const { count, ...concreteTask } = task;
      for (let repeat = 0; repeat < (rawCount ?? 1); repeat++) {
        expandedParallel.push({ ...concreteTask });
      }
    }
    expandedChain.push({ ...step, parallel: expandedParallel });
  }
  return { chain: expandedChain };
}

function normalizeRepeatedParallelCounts(params) {
  if (params.tasks) {
    const expandedTasks = expandTopLevelTaskCounts(params.tasks);
    if (expandedTasks.error) {
      return { error: buildRequestedModeError(params, expandedTasks.error) };
    }
    return { params: { ...params, tasks: expandedTasks.tasks } };
  }
  if (params.chain) {
    const expandedChain = expandChainParallelCounts(params.chain);
    if (expandedChain.error) {
      return { error: buildRequestedModeError(params, expandedChain.error) };
    }
    return { params: { ...params, chain: expandedChain.chain } };
  }
  return { params };
}

function withForkContext(
result,
context)
{
  if (context !== "fork" || !result.details) return result;
  return {
    ...result,
    details: {
      ...result.details,
      context: "fork"
    }
  };
}

function toExecutionErrorResult(params, error) {
  const message = error instanceof Error ? error.message : String(error);
  return withForkContext(
    {
      content: [{ type: "text", text: message }],
      isError: true,
      details: { mode: getRequestedModeLabel(params), results: [] }
    },
    params.context
  );
}

function collectChainSessionFiles(
chain,
sessionFileForIndex)
{
  const sessionFiles = [];
  let flatIndex = 0;
  for (const step of chain) {
    if ((0, _settings.isParallelStep)(step)) {
      for (let i = 0; i < step.parallel.length; i++) {
        sessionFiles.push(sessionFileForIndex(flatIndex));
        flatIndex++;
      }
      continue;
    }
    sessionFiles.push(sessionFileForIndex(flatIndex));
    flatIndex++;
  }
  return sessionFiles;
}

function wrapChainTasksForFork(chain, context) {
  if (context !== "fork") return chain;
  return chain.map((step, stepIndex) => {
    if ((0, _settings.isParallelStep)(step)) {
      return {
        ...step,
        parallel: step.parallel.map((task) => ({
          ...task,
          task: (0, _types.wrapForkTask)(task.task ?? "{previous}")
        }))
      };
    }
    const sequential = step;
    return {
      ...sequential,
      task: (0, _types.wrapForkTask)(sequential.task ?? (stepIndex === 0 ? "{task}" : "{previous}"))
    };
  });
}

function runAsyncPath(data, deps) {
  const {
    params,
    effectiveCwd,
    agents,
    ctx,
    shareEnabled,
    sessionRoot,
    sessionFileForIndex,
    artifactConfig,
    artifactsDir,
    effectiveAsync,
    controlConfig,
    intercomBridge
  } = data;
  const hasChain = (params.chain?.length ?? 0) > 0;
  const hasTasks = (params.tasks?.length ?? 0) > 0;
  const hasSingle = !hasChain && !hasTasks && Boolean(params.agent);
  if (!effectiveAsync) return null;

  if (hasChain && params.chain) {
    const chainWorktreeTaskCwdError = buildChainWorktreeTaskCwdError(params.chain, effectiveCwd);
    if (chainWorktreeTaskCwdError) {
      return {
        content: [{ type: "text", text: chainWorktreeTaskCwdError }],
        isError: true,
        details: { mode: "chain", results: [] }
      };
    }
  }

  if (hasTasks && params.tasks) {
    const maxParallelTasks = (0, _types.resolveTopLevelParallelMaxTasks)(deps.config.parallel?.maxTasks);
    if (params.tasks.length > maxParallelTasks) {
      return buildParallelModeError(`Max ${maxParallelTasks} tasks`);
    }
    if (params.worktree) {
      const worktreeTaskCwdError = buildParallelWorktreeTaskCwdError(params.tasks, effectiveCwd);
      if (worktreeTaskCwdError) return buildParallelModeError(worktreeTaskCwdError);
    }
  }

  if (!(0, _asyncExecution.isAsyncAvailable)()) {
    return {
      content: [{ type: "text", text: "Async mode requires jiti for TypeScript execution but it could not be found. Install globally: npm install -g jiti" }],
      isError: true,
      details: { mode: "single", results: [] }
    };
  }
  const id = (0, _nodeCrypto.randomUUID)();
  const asyncCtx = {
    pi: deps.pi,
    cwd: ctx.cwd,
    currentSessionId: deps.state.currentSessionId,
    currentModelProvider: ctx.model?.provider
  };
  const availableModels = ctx.modelRegistry.getAvailable().map(_modelInfo.toModelInfo);
  const currentMaxSubagentDepth = (0, _types.resolveCurrentMaxSubagentDepth)(deps.config.maxSubagentDepth);
  const currentProvider = ctx.model?.provider;
  const controlIntercomTarget = intercomBridge.active ? intercomBridge.orchestratorTarget : undefined;
  const childIntercomTarget = intercomBridge.active ? (agent, index) => (0, _intercomBridge.resolveSubagentIntercomTarget)(id, agent, index) : undefined;

  if (hasTasks && params.tasks) {
    const agentConfigs = params.tasks.map((task) => agents.find((agent) => agent.name === task.agent));
    const modelOverrides = params.tasks.map((task, index) =>
    (0, _modelFallback.resolveModelCandidate)(task.model ?? agentConfigs[index]?.model, availableModels, currentProvider)
    );
    const skillOverrides = params.tasks.map((task) => (0, _skills.normalizeSkillInput)(task.skill));
    const parallelTasks = params.tasks.map((task, index) => ({
      agent: task.agent,
      task: params.context === "fork" ? (0, _types.wrapForkTask)(task.task) : task.task,
      cwd: task.cwd,
      ...(modelOverrides[index] ? { model: modelOverrides[index] } : {}),
      ...(skillOverrides[index] !== undefined ? { skill: skillOverrides[index] } : {}),
      ...(task.output === true ? agentConfigs[index]?.output ? { output: agentConfigs[index].output } : {} : task.output !== undefined ? { output: task.output } : {}),
      ...(task.outputMode !== undefined ? { outputMode: task.outputMode } : {}),
      ...(task.reads !== undefined && task.reads !== true ? { reads: task.reads } : {}),
      ...(task.progress !== undefined ? { progress: task.progress } : {})
    }));
    return (0, _asyncExecution.executeAsyncChain)(id, {
      chain: [{
        parallel: parallelTasks,
        concurrency: (0, _types.resolveTopLevelParallelConcurrency)(params.concurrency, deps.config.parallel?.concurrency),
        worktree: params.worktree
      }],
      resultMode: "parallel",
      agents,
      ctx: asyncCtx,
      availableModels,
      cwd: effectiveCwd,
      maxOutput: params.maxOutput,
      artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
      artifactConfig,
      shareEnabled,
      sessionRoot,
      chainSkills: [],
      sessionFilesByFlatIndex: params.tasks.map((_, index) => sessionFileForIndex(index)),
      maxSubagentDepth: currentMaxSubagentDepth,
      worktreeSetupHook: deps.config.worktreeSetupHook,
      worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
      controlConfig,
      controlIntercomTarget,
      childIntercomTarget
    });
  }

  if (hasChain && params.chain) {
    const normalized = (0, _skills.normalizeSkillInput)(params.skill);
    const chainSkills = normalized === false ? [] : normalized ?? [];
    const chain = wrapChainTasksForFork(params.chain, params.context);
    return (0, _asyncExecution.executeAsyncChain)(id, {
      chain,
      task: params.task,
      agents,
      ctx: asyncCtx,
      availableModels,
      cwd: effectiveCwd,
      maxOutput: params.maxOutput,
      artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
      artifactConfig,
      shareEnabled,
      sessionRoot,
      chainSkills,
      sessionFilesByFlatIndex: collectChainSessionFiles(chain, sessionFileForIndex),
      maxSubagentDepth: currentMaxSubagentDepth,
      worktreeSetupHook: deps.config.worktreeSetupHook,
      worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
      controlConfig,
      controlIntercomTarget,
      childIntercomTarget
    });
  }

  if (hasSingle) {
    const a = agents.find((x) => x.name === params.agent);
    if (!a) {
      return {
        content: [{ type: "text", text: `Unknown agent: ${params.agent}` }],
        isError: true,
        details: { mode: "single", results: [] }
      };
    }
    const rawOutput = params.output !== undefined ? params.output : a.output;
    const effectiveOutput = rawOutput === true ? a.output : rawOutput;
    const effectiveOutputMode = params.outputMode ?? "inline";
    const normalizedSkills = (0, _skills.normalizeSkillInput)(params.skill);
    const skills = normalizedSkills === false ? [] : normalizedSkills;
    const maxSubagentDepth = (0, _types.resolveChildMaxSubagentDepth)(currentMaxSubagentDepth, a.maxSubagentDepth);
    const modelOverride = (0, _modelFallback.resolveModelCandidate)(params.model ?? a.model, availableModels, currentProvider);
    return (0, _asyncExecution.executeAsyncSingle)(id, {
      agent: params.agent,
      task: params.context === "fork" ? (0, _types.wrapForkTask)(params.task ?? "") : params.task ?? "",
      agentConfig: a,
      ctx: asyncCtx,
      availableModels,
      cwd: effectiveCwd,
      maxOutput: params.maxOutput,
      artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
      artifactConfig,
      shareEnabled,
      sessionRoot,
      sessionFile: sessionFileForIndex(0),
      skills,
      output: effectiveOutput,
      outputMode: effectiveOutputMode,
      modelOverride,
      maxSubagentDepth,
      worktreeSetupHook: deps.config.worktreeSetupHook,
      worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
      controlConfig,
      controlIntercomTarget,
      childIntercomTarget: childIntercomTarget ? (agent, index) => childIntercomTarget(agent, index) : undefined
    });
  }

  return null;
}

async function runChainPath(data, deps) {
  const {
    params,
    effectiveCwd,
    agents,
    ctx,
    signal,
    runId,
    shareEnabled,
    sessionDirForIndex,
    sessionFileForIndex,
    artifactsDir,
    artifactConfig,
    onUpdate,
    sessionRoot,
    controlConfig
  } = data;
  const onControlEvent = createForegroundControlNotifier(data, deps);
  const childIntercomTarget = data.intercomBridge.active ? _intercomBridge.resolveSubagentIntercomTarget : undefined;
  const foregroundControl = deps.state.foregroundControls.get(runId);
  const normalized = (0, _skills.normalizeSkillInput)(params.skill);
  const chainSkills = normalized === false ? [] : normalized ?? [];
  const chain = wrapChainTasksForFork(params.chain, params.context);
  const currentMaxSubagentDepth = (0, _types.resolveCurrentMaxSubagentDepth)(deps.config.maxSubagentDepth);
  const chainResult = await (0, _chainExecution.executeChain)({
    chain,
    task: params.task,
    agents,
    ctx,
    intercomEvents: deps.pi.events,
    signal,
    runId,
    cwd: effectiveCwd,
    shareEnabled,
    sessionDirForIndex,
    sessionFileForIndex,
    artifactsDir,
    artifactConfig,
    includeProgress: params.includeProgress,
    clarify: params.clarify,
    onUpdate,
    onControlEvent,
    controlConfig,
    childIntercomTarget: childIntercomTarget ? (agent, index) => childIntercomTarget(runId, agent, index) : undefined,
    orchestratorIntercomTarget: data.intercomBridge.active ? data.intercomBridge.orchestratorTarget : undefined,
    foregroundControl,
    chainSkills,
    chainDir: params.chainDir,
    maxSubagentDepth: currentMaxSubagentDepth,
    worktreeSetupHook: deps.config.worktreeSetupHook,
    worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs
  });

  if (chainResult.requestedAsync) {
    if (!(0, _asyncExecution.isAsyncAvailable)()) {
      return {
        content: [{ type: "text", text: "Background mode requires jiti for TypeScript execution but it could not be found." }],
        isError: true,
        details: { mode: "chain", results: [] }
      };
    }
    const id = (0, _nodeCrypto.randomUUID)();
    const asyncCtx = {
      pi: deps.pi,
      cwd: ctx.cwd,
      currentSessionId: deps.state.currentSessionId,
      currentModelProvider: ctx.model?.provider
    };
    const asyncChain = wrapChainTasksForFork(chainResult.requestedAsync.chain, params.context);
    return (0, _asyncExecution.executeAsyncChain)(id, {
      chain: asyncChain,
      task: params.task,
      agents,
      ctx: asyncCtx,
      availableModels: ctx.modelRegistry.getAvailable().map(_modelInfo.toModelInfo),
      cwd: effectiveCwd,
      maxOutput: params.maxOutput,
      artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
      artifactConfig,
      shareEnabled,
      sessionRoot,
      chainSkills: chainResult.requestedAsync.chainSkills,
      sessionFilesByFlatIndex: collectChainSessionFiles(asyncChain, sessionFileForIndex),
      maxSubagentDepth: currentMaxSubagentDepth,
      worktreeSetupHook: deps.config.worktreeSetupHook,
      worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
      controlConfig,
      controlIntercomTarget: data.intercomBridge.active ? data.intercomBridge.orchestratorTarget : undefined,
      childIntercomTarget: data.intercomBridge.active ? (agent, index) => (0, _intercomBridge.resolveSubagentIntercomTarget)(id, agent, index) : undefined
    });
  }

  const chainDetails = chainResult.details ? (0, _utils.compactForegroundDetails)({ ...chainResult.details, runId }) : undefined;
  if (chainDetails) rememberForegroundRun(deps.state, { runId, mode: "chain", cwd: effectiveCwd, results: chainDetails.results });
  const intercomReceipt = chainDetails && !chainDetails.results.some((result) => result.interrupted || result.detached) ?
  await maybeBuildForegroundIntercomReceipt({
    pi: deps.pi,
    intercomBridge: data.intercomBridge,
    runId,
    mode: "chain",
    details: chainDetails
  }) :
  null;
  if (intercomReceipt) {
    return {
      ...chainResult,
      content: [{ type: "text", text: intercomReceipt.text }],
      details: intercomReceipt.details
    };
  }

  return chainDetails ? { ...chainResult, details: chainDetails } : chainResult;
}

































function buildParallelModeError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    details: { mode: "parallel", results: [] }
  };
}

function createParallelWorktreeSetup(
enabled,
cwd,
runId,
tasks,
setupHook,
setupHookTimeoutMs)
{
  if (!enabled) return {};
  try {
    return {
      setup: (0, _worktree.createWorktrees)(cwd, runId, tasks.length, {
        agents: tasks.map((task) => task.agent),
        setupHook: setupHook ?
        { hookPath: setupHook, timeoutMs: setupHookTimeoutMs } :
        undefined
      })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { errorResult: buildParallelModeError(message) };
  }
}

function buildParallelWorktreeTaskCwdError(
tasks,
sharedCwd)
{
  const conflict = (0, _worktree.findWorktreeTaskCwdConflict)(tasks, sharedCwd);
  if (!conflict) return undefined;
  return (0, _worktree.formatWorktreeTaskCwdConflict)(conflict, sharedCwd);
}

function buildChainWorktreeTaskCwdError(chain, sharedCwd) {
  for (let stepIndex = 0; stepIndex < chain.length; stepIndex++) {
    const step = chain[stepIndex];
    if (!(0, _settings.isParallelStep)(step) || !step.worktree) continue;
    const stepCwd = (0, _utils.resolveChildCwd)(sharedCwd, step.cwd);
    const conflict = (0, _worktree.findWorktreeTaskCwdConflict)(step.parallel, stepCwd);
    if (!conflict) continue;
    const detail = (0, _worktree.formatWorktreeTaskCwdConflict)(conflict, stepCwd);
    return `parallel chain step ${stepIndex + 1}: ${detail}`;
  }
  return undefined;
}

function resolveParallelTaskCwd(
task,
paramsCwd,
worktreeSetup,
index)
{
  if (worktreeSetup) return worktreeSetup.worktrees[index].agentCwd;
  return (0, _utils.resolveChildCwd)(paramsCwd, task.cwd);
}

function buildParallelWorktreeSuffix(
worktreeSetup,
artifactsDir,
tasks)
{
  if (!worktreeSetup) return "";
  const diffsDir = path.join(artifactsDir, "worktree-diffs");
  const diffs = (0, _worktree.diffWorktrees)(worktreeSetup, tasks.map((task) => task.agent), diffsDir);
  return (0, _worktree.formatWorktreeDiffSummary)(diffs);
}

function findDuplicateParallelOutputPath(input)





{
  const seen = new Map();
  for (let index = 0; index < input.tasks.length; index++) {
    const behavior = input.behaviors[index];
    if (!behavior?.output) continue;
    const task = input.tasks[index];
    const taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);
    const outputPath = (0, _singleOutput.resolveSingleOutputPath)(behavior.output, input.ctxCwd, taskCwd);
    if (!outputPath) continue;
    const previous = seen.get(outputPath);
    if (previous) {
      return `Parallel tasks ${previous.index + 1} (${previous.agent}) and ${index + 1} (${task.agent}) resolve output to the same path: ${outputPath}. Use distinct output paths.`;
    }
    seen.set(outputPath, { index, agent: task.agent });
  }
  return undefined;
}

async function runForegroundParallelTasks(input) {
  return (0, _utils.mapConcurrent)(input.tasks, input.concurrencyLimit, async (task, index) => {
    const behavior = input.behaviors[index];
    const effectiveSkills = behavior?.skills;
    const taskCwd = resolveParallelTaskCwd(task, input.paramsCwd, input.worktreeSetup, index);
    const readInstructions = behavior ?
    (0, _settings.buildChainInstructions)({ ...behavior, output: false, progress: false }, taskCwd, false) :
    { prefix: "", suffix: "" };
    const progressInstructions = behavior ?
    (0, _settings.buildChainInstructions)({ ...behavior, output: false, reads: false }, input.paramsCwd, index === input.firstProgressIndex) :
    { prefix: "", suffix: "" };
    const outputPath = (0, _singleOutput.resolveSingleOutputPath)(behavior?.output, input.ctx.cwd, taskCwd);
    const taskText = (0, _singleOutput.injectSingleOutputInstruction)(
      `${readInstructions.prefix}${input.taskTexts[index]}${progressInstructions.suffix}`,
      outputPath
    );
    const interruptController = new AbortController();
    if (input.foregroundControl) {
      input.foregroundControl.currentAgent = task.agent;
      input.foregroundControl.currentIndex = index;
      input.foregroundControl.currentActivityState = undefined;
      input.foregroundControl.updatedAt = Date.now();
      input.foregroundControl.interrupt = () => {
        if (interruptController.signal.aborted) return false;
        interruptController.abort();
        input.foregroundControl.currentActivityState = undefined;
        input.foregroundControl.updatedAt = Date.now();
        return true;
      };
    }
    const agentConfig = input.agents.find((agent) => agent.name === task.agent);
    return (0, _execution.runSync)(input.ctx.cwd, input.agents, task.agent, taskText, {
      cwd: taskCwd,
      signal: input.signal,
      interruptSignal: interruptController.signal,
      allowIntercomDetach: agentConfig?.systemPrompt?.includes(_intercomBridge.INTERCOM_BRIDGE_MARKER) === true,
      intercomEvents: input.intercomEvents,
      runId: input.runId,
      index,
      sessionDir: input.sessionDirForIndex(index),
      sessionFile: input.sessionFileForIndex(index),
      share: input.shareEnabled,
      artifactsDir: input.artifactConfig.enabled ? input.artifactsDir : undefined,
      artifactConfig: input.artifactConfig,
      maxOutput: input.maxOutput,
      outputPath,
      outputMode: behavior?.outputMode,
      maxSubagentDepth: input.maxSubagentDepths[index],
      controlConfig: input.controlConfig,
      onControlEvent: input.onControlEvent,
      intercomSessionName: input.childIntercomTarget?.(task.agent, index),
      orchestratorIntercomTarget: input.orchestratorIntercomTarget,
      modelOverride: input.modelOverrides[index],
      availableModels: input.availableModels,
      preferredModelProvider: input.ctx.model?.provider,
      skills: effectiveSkills === false ? [] : effectiveSkills,
      onUpdate: input.onUpdate ?
      (progressUpdate) => {
        const stepResults = progressUpdate.details?.results || [];
        const stepProgress = progressUpdate.details?.progress || [];
        if (input.foregroundControl && stepProgress.length > 0) {
          const current = stepProgress[0];
          input.foregroundControl.currentAgent = task.agent;
          input.foregroundControl.currentIndex = index;
          input.foregroundControl.currentActivityState = current?.activityState;
          input.foregroundControl.lastActivityAt = current?.lastActivityAt;
          input.foregroundControl.currentTool = current?.currentTool;
          input.foregroundControl.currentToolStartedAt = current?.currentToolStartedAt;
          input.foregroundControl.currentPath = current?.currentPath;
          input.foregroundControl.turnCount = current?.turnCount;
          input.foregroundControl.tokens = current?.tokens;
          input.foregroundControl.toolCount = current?.toolCount;
          input.foregroundControl.updatedAt = Date.now();
        }
        if (stepResults.length > 0) input.liveResults[index] = stepResults[0];
        if (stepProgress.length > 0) input.liveProgress[index] = stepProgress[0];
        const mergedResults = input.liveResults.filter((result) => result !== undefined);
        const mergedProgress = input.liveProgress.filter((progress) => progress !== undefined);
        input.onUpdate?.({
          content: progressUpdate.content,
          details: {
            mode: "parallel",
            results: mergedResults,
            progress: mergedProgress,
            controlEvents: progressUpdate.details?.controlEvents,
            totalSteps: input.tasks.length
          }
        });
      } :
      undefined
    }).finally(() => {
      if (input.foregroundControl?.currentIndex === index) {
        input.foregroundControl.interrupt = undefined;
        input.foregroundControl.updatedAt = Date.now();
      }
    });
  });
}

async function runParallelPath(data, deps) {
  const {
    params,
    effectiveCwd,
    agents,
    ctx,
    signal,
    runId,
    sessionDirForIndex,
    sessionFileForIndex,
    shareEnabled,
    artifactConfig,
    artifactsDir,
    backgroundRequestedWhileClarifying,
    onUpdate,
    sessionRoot,
    controlConfig
  } = data;
  const onControlEvent = createForegroundControlNotifier(data, deps);
  const childIntercomTarget = data.intercomBridge.active ? _intercomBridge.resolveSubagentIntercomTarget : undefined;
  const allProgress = [];
  const allArtifactPaths = [];
  const tasks = params.tasks;
  const maxParallelTasks = (0, _types.resolveTopLevelParallelMaxTasks)(deps.config.parallel?.maxTasks);
  const parallelConcurrency = (0, _types.resolveTopLevelParallelConcurrency)(params.concurrency, deps.config.parallel?.concurrency);

  if (tasks.length > maxParallelTasks)
  return {
    content: [{ type: "text", text: `Max ${maxParallelTasks} tasks` }],
    isError: true,
    details: { mode: "parallel", results: [] }
  };

  const agentConfigs = [];
  for (const t of tasks) {
    const config = agents.find((a) => a.name === t.agent);
    if (!config) {
      return {
        content: [{ type: "text", text: `Unknown agent: ${t.agent}` }],
        isError: true,
        details: { mode: "parallel", results: [] }
      };
    }
    agentConfigs.push(config);
  }

  const currentMaxSubagentDepth = (0, _types.resolveCurrentMaxSubagentDepth)(deps.config.maxSubagentDepth);
  const maxSubagentDepths = agentConfigs.map((config) =>
  (0, _types.resolveChildMaxSubagentDepth)(currentMaxSubagentDepth, config.maxSubagentDepth)
  );

  if (params.worktree) {
    const worktreeTaskCwdError = buildParallelWorktreeTaskCwdError(tasks, effectiveCwd);
    if (worktreeTaskCwdError) return buildParallelModeError(worktreeTaskCwdError);
  }

  const currentProvider = ctx.model?.provider;
  const availableModels = ctx.modelRegistry.getAvailable().map(_modelInfo.toModelInfo);
  let taskTexts = tasks.map((t) => t.task);
  const skillOverrides = tasks.map((t) =>
  (0, _skills.normalizeSkillInput)(t.skill)
  );
  const behaviorOverrides = tasks.map((task, index) => ({
    ...(task.output !== undefined ? { output: task.output === true ? agentConfigs[index]?.output ?? false : task.output } : {}),
    ...(task.outputMode !== undefined ? { outputMode: task.outputMode } : {}),
    ...(task.reads !== undefined && task.reads !== true ? { reads: task.reads } : {}),
    ...(task.progress !== undefined ? { progress: task.progress } : {}),
    ...(skillOverrides[index] !== undefined ? { skills: skillOverrides[index] } : {}),
    ...(task.model ? { model: task.model } : {})
  }));
  const modelOverrides = tasks.map((_, i) =>
  (0, _modelFallback.resolveModelCandidate)(behaviorOverrides[i]?.model ?? agentConfigs[i]?.model, availableModels, currentProvider)
  );

  if (params.clarify === true && ctx.hasUI) {
    const behaviors = agentConfigs.map((c, i) =>
    (0, _settings.resolveStepBehavior)(c, behaviorOverrides[i])
    );
    const availableSkills = (0, _skills.discoverAvailableSkills)(effectiveCwd);

    const result = await ctx.ui.custom(
      (tui, theme, _kb, done) =>
      new _chainClarify.ChainClarifyComponent(
        tui, theme,
        agentConfigs,
        taskTexts,
        "",
        undefined,
        behaviors,
        availableModels,
        currentProvider,
        availableSkills,
        done,
        "parallel"
      ),
      { overlay: true, overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" } }
    );

    if (!result || !result.confirmed) {
      return { content: [{ type: "text", text: "Cancelled" }], details: { mode: "parallel", results: [] } };
    }

    taskTexts = result.templates;
    for (let i = 0; i < result.behaviorOverrides.length; i++) {
      const override = result.behaviorOverrides[i];
      if (override?.model) {
        modelOverrides[i] = override.model;
        behaviorOverrides[i].model = override.model;
      }
      if (override?.output !== undefined) behaviorOverrides[i].output = override.output;
      if (override?.reads !== undefined) behaviorOverrides[i].reads = override.reads;
      if (override?.progress !== undefined) behaviorOverrides[i].progress = override.progress;
      if (override?.skills !== undefined) {
        skillOverrides[i] = override.skills;
        behaviorOverrides[i].skills = override.skills;
      }
    }

    if (result.runInBackground) {
      if (!(0, _asyncExecution.isAsyncAvailable)()) {
        return {
          content: [{ type: "text", text: "Background mode requires jiti for TypeScript execution but it could not be found." }],
          isError: true,
          details: { mode: "parallel", results: [] }
        };
      }
      const id = (0, _nodeCrypto.randomUUID)();
      const asyncCtx = {
        pi: deps.pi,
        cwd: ctx.cwd,
        currentSessionId: deps.state.currentSessionId,
        currentModelProvider: ctx.model?.provider
      };
      const parallelTasks = tasks.map((t, i) => {
        const taskText = params.context === "fork" ? (0, _types.wrapForkTask)(taskTexts[i]) : taskTexts[i];
        const progress = (0, _settings.taskDisallowsFileUpdates)(taskText) ? false : behaviorOverrides[i]?.progress;
        return {
          agent: t.agent,
          task: taskText,
          cwd: t.cwd,
          ...(modelOverrides[i] ? { model: modelOverrides[i] } : {}),
          ...(skillOverrides[i] !== undefined ? { skill: skillOverrides[i] } : {}),
          ...(behaviorOverrides[i]?.output !== undefined ? { output: behaviorOverrides[i].output } : {}),
          ...(behaviorOverrides[i]?.outputMode !== undefined ? { outputMode: behaviorOverrides[i].outputMode } : {}),
          ...(behaviorOverrides[i]?.reads !== undefined ? { reads: behaviorOverrides[i].reads } : {}),
          ...(progress !== undefined ? { progress } : {})
        };
      });
      return (0, _asyncExecution.executeAsyncChain)(id, {
        chain: [{ parallel: parallelTasks, concurrency: parallelConcurrency, worktree: params.worktree }],
        resultMode: "parallel",
        agents,
        ctx: asyncCtx,
        availableModels,
        cwd: effectiveCwd,
        maxOutput: params.maxOutput,
        artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
        artifactConfig,
        shareEnabled,
        sessionRoot,
        chainSkills: [],
        sessionFilesByFlatIndex: tasks.map((_, index) => sessionFileForIndex(index)),
        maxSubagentDepth: currentMaxSubagentDepth,
        worktreeSetupHook: deps.config.worktreeSetupHook,
        worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
        controlConfig,
        controlIntercomTarget: data.intercomBridge.active ? data.intercomBridge.orchestratorTarget : undefined,
        childIntercomTarget: data.intercomBridge.active ? (agent, index) => (0, _intercomBridge.resolveSubagentIntercomTarget)(id, agent, index) : undefined
      });
    }
  }

  const behaviors = agentConfigs.map((config, index) => (0, _settings.suppressProgressForReadOnlyTask)((0, _settings.resolveStepBehavior)(config, behaviorOverrides[index]), taskTexts[index]));
  const firstProgressIndex = behaviors.findIndex((behavior) => behavior.progress);
  const liveResults = new Array(tasks.length).fill(undefined);
  const liveProgress = new Array(tasks.length).fill(undefined);
  const foregroundControl = deps.state.foregroundControls.get(runId);
  const { setup: worktreeSetup, errorResult } = createParallelWorktreeSetup(
    params.worktree,
    effectiveCwd,
    runId,
    tasks,
    deps.config.worktreeSetupHook,
    deps.config.worktreeSetupHookTimeoutMs
  );
  if (errorResult) return errorResult;

  try {
    const duplicateOutputError = findDuplicateParallelOutputPath({
      tasks,
      behaviors,
      paramsCwd: effectiveCwd,
      ctxCwd: ctx.cwd,
      worktreeSetup
    });
    if (duplicateOutputError) return buildParallelModeError(duplicateOutputError);
    for (let index = 0; index < tasks.length; index++) {
      const taskCwd = resolveParallelTaskCwd(tasks[index], effectiveCwd, worktreeSetup, index);
      const outputPath = (0, _singleOutput.resolveSingleOutputPath)(behaviors[index]?.output, ctx.cwd, taskCwd);
      const validationError = (0, _singleOutput.validateFileOnlyOutputMode)(behaviors[index]?.outputMode, outputPath, `Parallel task ${index + 1} (${tasks[index].agent})`);
      if (validationError) return buildParallelModeError(validationError);
    }

    const parallelProgressPrecreated = firstProgressIndex !== -1;
    if (parallelProgressPrecreated) (0, _settings.writeInitialProgressFile)(effectiveCwd);

    if (params.context === "fork") {
      for (let i = 0; i < taskTexts.length; i++) {
        taskTexts[i] = (0, _types.wrapForkTask)(taskTexts[i]);
      }
    }

    const results = await runForegroundParallelTasks({
      tasks,
      taskTexts,
      agents,
      ctx,
      intercomEvents: deps.pi.events,
      signal,
      runId,
      sessionDirForIndex,
      sessionFileForIndex,
      shareEnabled,
      artifactConfig,
      artifactsDir,
      maxOutput: params.maxOutput,
      paramsCwd: effectiveCwd,
      availableModels,
      modelOverrides,
      behaviors,
      firstProgressIndex: parallelProgressPrecreated ? -1 : firstProgressIndex,
      controlConfig,
      onControlEvent,
      childIntercomTarget: childIntercomTarget ? (agent, index) => childIntercomTarget(runId, agent, index) : undefined,
      orchestratorIntercomTarget: data.intercomBridge.active ? data.intercomBridge.orchestratorTarget : undefined,
      foregroundControl,
      concurrencyLimit: parallelConcurrency,
      maxSubagentDepths,
      liveResults,
      liveProgress,
      onUpdate,
      worktreeSetup
    });
    for (let i = 0; i < results.length; i++) {
      const run = results[i];
      (0, _runHistory.recordRun)(run.agent, taskTexts[i], run.exitCode, run.progressSummary?.durationMs ?? 0);
    }

    for (const result of results) {
      if (result.progress) allProgress.push(result.progress);
      if (result.artifactPaths) allArtifactPaths.push(result.artifactPaths);
    }

    const interrupted = results.find((result) => result.interrupted);
    const details = (0, _utils.compactForegroundDetails)({
      mode: "parallel",
      runId,
      results,
      progress: params.includeProgress ? allProgress : undefined,
      artifacts: allArtifactPaths.length ? { dir: artifactsDir, files: allArtifactPaths } : undefined
    });
    rememberForegroundRun(deps.state, { runId, mode: "parallel", cwd: effectiveCwd, results: details.results });
    if (interrupted) {
      return {
        content: [{ type: "text", text: `Parallel run paused after interrupt (${interrupted.agent}). Waiting for explicit next action.` }],
        details
      };
    }
    const detachedIndex = results.findIndex((result) => result.detached);
    const detached = detachedIndex >= 0 ? results[detachedIndex] : undefined;
    if (detached) {
      return {
        content: [{ type: "text", text: `Parallel run detached for intercom coordination (${detached.agent}). Reply to the supervisor request first. After the child exits, start a fresh follow-up if needed.` }],
        details
      };
    }

    const intercomReceipt = await maybeBuildForegroundIntercomReceipt({
      pi: deps.pi,
      intercomBridge: data.intercomBridge,
      runId,
      mode: "parallel",
      details
    });
    if (intercomReceipt) {
      return {
        content: [{ type: "text", text: intercomReceipt.text }],
        details: intercomReceipt.details
      };
    }

    const worktreeSuffix = buildParallelWorktreeSuffix(worktreeSetup, artifactsDir, tasks);
    const ok = results.filter((result) => result.exitCode === 0).length;
    const downgradeNote = backgroundRequestedWhileClarifying ? " (background requested, but clarify kept this run foreground)" : "";
    const aggregatedOutput = (0, _parallelUtils.aggregateParallelOutputs)(
      results.map((result) => ({
        agent: result.agent,
        output: result.truncation?.text || (0, _utils.getSingleResultOutput)(result),
        exitCode: result.exitCode,
        error: result.error
      })),
      (i, agent) => `=== Task ${i + 1}: ${agent} ===`
    );

    const summary = `${ok}/${results.length} succeeded${downgradeNote}`;
    const fullContent = worktreeSuffix ?
    `${summary}\n\n${aggregatedOutput}\n\n${worktreeSuffix}` :
    `${summary}\n\n${aggregatedOutput}`;

    return {
      content: [{ type: "text", text: fullContent }],
      details
    };
  } finally {
    if (worktreeSetup) (0, _worktree.cleanupWorktrees)(worktreeSetup);
  }
}

async function runSinglePath(data, deps) {
  const {
    params,
    effectiveCwd,
    agents,
    ctx,
    signal,
    runId,
    sessionDirForIndex,
    sessionFileForIndex,
    shareEnabled,
    artifactConfig,
    artifactsDir,
    onUpdate,
    sessionRoot,
    controlConfig
  } = data;
  const onControlEvent = createForegroundControlNotifier(data, deps);
  const childIntercomTarget = data.intercomBridge.active ? (0, _intercomBridge.resolveSubagentIntercomTarget)(runId, params.agent, 0) : undefined;
  const allProgress = [];
  const allArtifactPaths = [];
  const agentConfig = agents.find((a) => a.name === params.agent);
  if (!agentConfig) {
    return {
      content: [{ type: "text", text: `Unknown agent: ${params.agent}` }],
      isError: true,
      details: { mode: "single", results: [] }
    };
  }

  const currentProvider = ctx.model?.provider;
  const availableModels = ctx.modelRegistry.getAvailable().map(_modelInfo.toModelInfo);
  let task = params.task ?? "";
  let modelOverride = (0, _modelFallback.resolveModelCandidate)(
    params.model ?? agentConfig.model,
    availableModels,
    currentProvider
  );
  let skillOverride = (0, _skills.normalizeSkillInput)(params.skill);
  const rawOutput = params.output !== undefined ? params.output : agentConfig.output;
  let effectiveOutput = rawOutput === true ? agentConfig.output : rawOutput;
  const effectiveOutputMode = params.outputMode ?? "inline";
  const currentMaxSubagentDepth = (0, _types.resolveCurrentMaxSubagentDepth)(deps.config.maxSubagentDepth);
  const maxSubagentDepth = (0, _types.resolveChildMaxSubagentDepth)(currentMaxSubagentDepth, agentConfig.maxSubagentDepth);

  if (params.clarify === true && ctx.hasUI) {
    const behavior = (0, _settings.resolveStepBehavior)(agentConfig, { output: effectiveOutput, skills: skillOverride });
    const availableSkills = (0, _skills.discoverAvailableSkills)(effectiveCwd);

    const result = await ctx.ui.custom(
      (tui, theme, _kb, done) =>
      new _chainClarify.ChainClarifyComponent(
        tui, theme,
        [agentConfig],
        [task],
        task,
        undefined,
        [behavior],
        availableModels,
        currentProvider,
        availableSkills,
        done,
        "single"
      ),
      { overlay: true, overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" } }
    );

    if (!result || !result.confirmed) {
      return { content: [{ type: "text", text: "Cancelled" }], details: { mode: "single", results: [] } };
    }

    task = result.templates[0];
    const override = result.behaviorOverrides[0];
    if (override?.model) modelOverride = override.model;
    if (override?.output !== undefined) effectiveOutput = override.output;
    if (override?.skills !== undefined) skillOverride = override.skills;

    if (result.runInBackground) {
      if (!(0, _asyncExecution.isAsyncAvailable)()) {
        return {
          content: [{ type: "text", text: "Background mode requires jiti for TypeScript execution but it could not be found." }],
          isError: true,
          details: { mode: "single", results: [] }
        };
      }
      const id = (0, _nodeCrypto.randomUUID)();
      const asyncCtx = {
        pi: deps.pi,
        cwd: ctx.cwd,
        currentSessionId: deps.state.currentSessionId,
        currentModelProvider: ctx.model?.provider
      };
      return (0, _asyncExecution.executeAsyncSingle)(id, {
        agent: params.agent,
        task: params.context === "fork" ? (0, _types.wrapForkTask)(task) : task,
        agentConfig,
        ctx: asyncCtx,
        availableModels,
        cwd: effectiveCwd,
        maxOutput: params.maxOutput,
        artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
        artifactConfig,
        shareEnabled,
        sessionRoot,
        sessionFile: sessionFileForIndex(0),
        skills: skillOverride === false ? [] : skillOverride,
        output: effectiveOutput,
        outputMode: effectiveOutputMode,
        modelOverride,
        maxSubagentDepth,
        worktreeSetupHook: deps.config.worktreeSetupHook,
        worktreeSetupHookTimeoutMs: deps.config.worktreeSetupHookTimeoutMs,
        controlConfig,
        controlIntercomTarget: data.intercomBridge.active ? data.intercomBridge.orchestratorTarget : undefined,
        childIntercomTarget: data.intercomBridge.active ? (agent, index) => (0, _intercomBridge.resolveSubagentIntercomTarget)(id, agent, index) : undefined
      });
    }
  }

  if (params.context === "fork") {
    task = (0, _types.wrapForkTask)(task);
  }
  const cleanTask = task;
  const outputPath = (0, _singleOutput.resolveSingleOutputPath)(effectiveOutput, ctx.cwd, effectiveCwd);
  const validationError = (0, _singleOutput.validateFileOnlyOutputMode)(effectiveOutputMode, outputPath, `Single run (${params.agent})`);
  if (validationError) {
    return { content: [{ type: "text", text: validationError }], isError: true, details: { mode: "single", results: [] } };
  }
  task = (0, _singleOutput.injectSingleOutputInstruction)(task, outputPath);

  let effectiveSkills;
  if (skillOverride === false) {
    effectiveSkills = [];
  } else {
    effectiveSkills = skillOverride;
  }
  const interruptController = new AbortController();
  const foregroundControl = deps.state.foregroundControls.get(runId);
  if (foregroundControl) {
    foregroundControl.currentAgent = params.agent;
    foregroundControl.currentIndex = 0;
    foregroundControl.currentActivityState = undefined;
    foregroundControl.updatedAt = Date.now();
    foregroundControl.interrupt = () => {
      if (interruptController.signal.aborted) return false;
      interruptController.abort();
      foregroundControl.currentActivityState = undefined;
      foregroundControl.updatedAt = Date.now();
      return true;
    };
  }

  const forwardSingleUpdate = onUpdate ?
  (update) => {
    if (foregroundControl) {
      const firstProgress = update.details?.progress?.[0];
      foregroundControl.currentAgent = params.agent;
      foregroundControl.currentIndex = firstProgress?.index ?? 0;
      foregroundControl.currentActivityState = firstProgress?.activityState;
      foregroundControl.lastActivityAt = firstProgress?.lastActivityAt;
      foregroundControl.currentTool = firstProgress?.currentTool;
      foregroundControl.currentToolStartedAt = firstProgress?.currentToolStartedAt;
      foregroundControl.currentPath = firstProgress?.currentPath;
      foregroundControl.turnCount = firstProgress?.turnCount;
      foregroundControl.tokens = firstProgress?.tokens;
      foregroundControl.toolCount = firstProgress?.toolCount;
      foregroundControl.updatedAt = Date.now();
    }
    onUpdate(update);
  } :
  undefined;

  const r = await (0, _execution.runSync)(ctx.cwd, agents, params.agent, task, {
    cwd: effectiveCwd,
    signal,
    interruptSignal: interruptController.signal,
    allowIntercomDetach: agentConfig.systemPrompt?.includes(_intercomBridge.INTERCOM_BRIDGE_MARKER) === true,
    intercomEvents: deps.pi.events,
    runId,
    sessionDir: sessionDirForIndex(0),
    sessionFile: sessionFileForIndex(0),
    share: shareEnabled,
    artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
    artifactConfig,
    maxOutput: params.maxOutput,
    outputPath,
    outputMode: effectiveOutputMode,
    maxSubagentDepth,
    onUpdate: forwardSingleUpdate,
    controlConfig,
    onControlEvent,
    intercomSessionName: childIntercomTarget,
    orchestratorIntercomTarget: data.intercomBridge.active ? data.intercomBridge.orchestratorTarget : undefined,
    index: 0,
    modelOverride,
    availableModels,
    preferredModelProvider: currentProvider,
    skills: effectiveSkills
  });
  if (foregroundControl?.currentIndex === 0) {
    foregroundControl.interrupt = undefined;
    foregroundControl.currentActivityState = r.progress?.activityState;
    foregroundControl.lastActivityAt = r.progress?.lastActivityAt;
    foregroundControl.currentTool = r.progress?.currentTool;
    foregroundControl.currentToolStartedAt = r.progress?.currentToolStartedAt;
    foregroundControl.currentPath = r.progress?.currentPath;
    foregroundControl.turnCount = r.progress?.turnCount;
    foregroundControl.tokens = r.progress?.tokens;
    foregroundControl.toolCount = r.progress?.toolCount;
    foregroundControl.updatedAt = Date.now();
  }
  (0, _runHistory.recordRun)(params.agent, cleanTask, r.exitCode, r.progressSummary?.durationMs ?? 0);

  if (r.progress) allProgress.push(r.progress);
  if (r.artifactPaths) allArtifactPaths.push(r.artifactPaths);

  const fullOutput = (0, _utils.getSingleResultOutput)(r);
  const finalizedOutput = (0, _singleOutput.finalizeSingleOutput)({
    fullOutput,
    truncatedOutput: r.truncation?.text,
    outputPath,
    outputMode: r.outputMode,
    exitCode: r.exitCode,
    savedPath: r.savedOutputPath,
    outputReference: r.outputReference,
    saveError: r.outputSaveError
  });
  const details = (0, _utils.compactForegroundDetails)({
    mode: "single",
    runId,
    results: [r],
    progress: params.includeProgress ? allProgress : undefined,
    artifacts: allArtifactPaths.length ? { dir: artifactsDir, files: allArtifactPaths } : undefined,
    truncation: r.truncation
  });
  rememberForegroundRun(deps.state, { runId, mode: "single", cwd: effectiveCwd, results: details.results });

  if (!r.detached && !r.interrupted) {
    const intercomReceipt = await maybeBuildForegroundIntercomReceipt({
      pi: deps.pi,
      intercomBridge: data.intercomBridge,
      runId,
      mode: "single",
      details
    });
    if (intercomReceipt) {
      return {
        content: [{ type: "text", text: intercomReceipt.text }],
        details: intercomReceipt.details,
        ...(r.exitCode !== 0 ? { isError: true } : {})
      };
    }
  }

  if (r.detached) {
    return {
      content: [{ type: "text", text: `Detached for intercom coordination: ${params.agent}. Reply to the supervisor request first. After the child exits, start a fresh follow-up if needed.` }],
      details
    };
  }

  if (r.interrupted) {
    return {
      content: [{ type: "text", text: `Run paused after interrupt (${params.agent}). Waiting for explicit next action.` }],
      details
    };
  }

  if (r.exitCode !== 0)
  return {
    content: [{ type: "text", text: r.error || "Failed" }],
    details,
    isError: true
  };
  return {
    content: [{ type: "text", text: finalizedOutput.displayOutput || "(no output)" }],
    details
  };
}

function createSubagentExecutor(deps)







{
  const execute = async (
  _id,
  params,
  signal,
  onUpdate,
  ctx) =>
  {
    deps.state.baseCwd = ctx.cwd;
    deps.state.foregroundRuns ??= new Map();
    deps.state.foregroundControls ??= new Map();
    deps.state.lastForegroundControlId ??= null;
    const requestCwd = resolveRequestedCwd(ctx.cwd, params.cwd);
    const paramsWithResolvedCwd = params.cwd === undefined ? params : { ...params, cwd: requestCwd };
    if (params.action) {
      if (params.action === "doctor") {
        let currentSessionFile = null;
        let currentSessionId = deps.state.currentSessionId;
        let sessionError;
        try {
          currentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
          currentSessionId = ctx.sessionManager.getSessionId();
        } catch (error) {
          sessionError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        let orchestratorTarget;
        try {
          orchestratorTarget = (0, _intercomBridge.resolveIntercomSessionTarget)(deps.pi.getSessionName(), ctx.sessionManager.getSessionId());
        } catch {}
        return {
          content: [{
            type: "text",
            text: (0, _doctor.buildDoctorReport)({
              cwd: requestCwd,
              config: deps.config,
              state: deps.state,
              context: paramsWithResolvedCwd.context,
              requestedSessionDir: paramsWithResolvedCwd.sessionDir,
              currentSessionFile,
              currentSessionId,
              orchestratorTarget,
              sessionError,
              expandTilde: deps.expandTilde
            })
          }],
          details: { mode: "management", results: [] }
        };
      }
      if (params.action === "status") {
        const foreground = getForegroundControl(deps.state, paramsWithResolvedCwd.id ?? paramsWithResolvedCwd.runId);
        if (foreground) return foregroundStatusResult(foreground);
        return (0, _runStatus.inspectSubagentStatus)(paramsWithResolvedCwd);
      }
      if (params.action === "resume") {
        return resumeAsyncRun({ params: paramsWithResolvedCwd, requestCwd, ctx, deps });
      }
      if (params.action === "interrupt") {
        const targetRunId = paramsWithResolvedCwd.runId ?? paramsWithResolvedCwd.id;
        const foreground = getForegroundControl(deps.state, targetRunId);
        if (foreground?.interrupt) {
          const interrupted = foreground.interrupt();
          if (interrupted) {
            foreground.updatedAt = Date.now();
            foreground.currentActivityState = undefined;
            return {
              content: [{ type: "text", text: `Interrupt requested for foreground run ${foreground.runId}.` }],
              details: { mode: "management", results: [] }
            };
          }
          return {
            content: [{ type: "text", text: `Foreground run ${foreground.runId} has no active child step to interrupt.` }],
            isError: true,
            details: { mode: "management", results: [] }
          };
        }
        const asyncInterruptResult = interruptAsyncRun(deps.state, targetRunId);
        if (asyncInterruptResult) return asyncInterruptResult;
        return {
          content: [{ type: "text", text: "No interrupt-capable run found in this session." }],
          isError: true,
          details: { mode: "management", results: [] }
        };
      }
      if (!_types.SUBAGENT_ACTIONS.includes(params.action)) {
        return {
          content: [{ type: "text", text: `Unknown action: ${params.action}. Valid: ${_types.SUBAGENT_ACTIONS.join(", ")}` }],
          isError: true,
          details: { mode: "management", results: [] }
        };
      }
      return (0, _agentManagement.handleManagementAction)(params.action, paramsWithResolvedCwd, { ...ctx, cwd: requestCwd });
    }

    const { blocked, depth, maxDepth } = (0, _types.checkSubagentDepth)(deps.config.maxSubagentDepth);
    if (blocked) {
      return {
        content: [
        {
          type: "text",
          text:
          `Nested subagent call blocked (depth=${depth}, max=${maxDepth}). ` +
          "You are running at the maximum subagent nesting depth. " +
          "Complete your current task directly without delegating to further subagents."
        }],

        isError: true,
        details: { mode: "single", results: [] }
      };
    }

    const normalized = normalizeRepeatedParallelCounts(paramsWithResolvedCwd);
    if (normalized.error) return normalized.error;
    const normalizedParams = normalized.params;

    let effectiveParams = (0, _topLevelAsync.applyForceTopLevelAsyncOverride)(
      normalizedParams,
      depth,
      deps.config.forceTopLevelAsync === true
    );

    const scope = (0, _agentScope.resolveExecutionAgentScope)(effectiveParams.agentScope);
    const effectiveCwd = effectiveParams.cwd ?? ctx.cwd;
    const parentSessionFile = ctx.sessionManager.getSessionFile() ?? null;
    deps.state.currentSessionId = (0, _sessionIdentity.resolveCurrentSessionId)(ctx.sessionManager);
    const discoveredAgents = deps.discoverAgents(effectiveCwd, scope).agents;
    effectiveParams = applyAgentDefaultContext(effectiveParams, discoveredAgents);
    const sessionName = (0, _intercomBridge.resolveIntercomSessionTarget)(deps.pi.getSessionName(), ctx.sessionManager.getSessionId());
    const intercomBridge = (0, _intercomBridge.resolveIntercomBridge)({
      config: deps.config.intercomBridge,
      context: effectiveParams.context,
      orchestratorTarget: sessionName,
      cwd: effectiveCwd
    });
    const agents = intercomBridge.active ?
    discoveredAgents.map((agent) => (0, _intercomBridge.applyIntercomBridgeToAgent)(agent, intercomBridge)) :
    discoveredAgents;
    const runId = (0, _nodeCrypto.randomUUID)().slice(0, 8);
    const shareEnabled = effectiveParams.share === true;
    const hasChain = (effectiveParams.chain?.length ?? 0) > 0;
    const hasTasks = (effectiveParams.tasks?.length ?? 0) > 0;
    const hasSingle = !hasChain && !hasTasks && Boolean(effectiveParams.agent);
    const allowClarifyTaskPrompt = hasChain &&
    effectiveParams.clarify === true &&
    ctx.hasUI &&
    !(effectiveParams.chain?.some(_settings.isParallelStep) ?? false);

    const validationError = validateExecutionInput(
      effectiveParams,
      agents,
      hasChain,
      hasTasks,
      hasSingle,
      allowClarifyTaskPrompt
    );
    if (validationError) return validationError;

    let sessionFileForIndex = () => undefined;
    try {
      sessionFileForIndex = (0, _forkContext.createForkContextResolver)(ctx.sessionManager, effectiveParams.context).sessionFileForIndex;
    } catch (error) {
      return toExecutionErrorResult(effectiveParams, error);
    }
    const requestedAsync = effectiveParams.async ?? deps.asyncByDefault;
    const backgroundRequestedWhileClarifying = hasTasks && requestedAsync && effectiveParams.clarify === true;
    const effectiveAsync = requestedAsync && (
    hasChain ? effectiveParams.clarify === false : effectiveParams.clarify !== true);
    const controlConfig = (0, _subagentControl.resolveControlConfig)(deps.config.control, effectiveParams.control);

    const artifactConfig = {
      ..._types.DEFAULT_ARTIFACT_CONFIG,
      enabled: effectiveParams.artifacts !== false
    };
    const artifactsDir = effectiveAsync ? deps.tempArtifactsDir : (0, _artifacts.getArtifactsDir)(parentSessionFile);

    let sessionRoot;
    if (effectiveParams.sessionDir) {
      sessionRoot = path.resolve(deps.expandTilde(effectiveParams.sessionDir));
    } else {
      const baseSessionRoot = deps.config.defaultSessionDir ?
      path.resolve(deps.expandTilde(deps.config.defaultSessionDir)) :
      deps.getSubagentSessionRoot(parentSessionFile);
      sessionRoot = path.join(baseSessionRoot, runId);
    }
    try {
      fs.mkdirSync(sessionRoot, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toExecutionErrorResult(
        effectiveParams,
        new Error(`Failed to create session directory '${sessionRoot}': ${message}`)
      );
    }
    const sessionDirForIndex = (idx) =>
    path.join(sessionRoot, `run-${idx ?? 0}`);
    const childSessionFileForIndex = (idx) =>
    sessionFileForIndex(idx) ?? path.join(sessionDirForIndex(idx), "session.jsonl");

    const onUpdateWithContext = onUpdate ?
    (r) => onUpdate(withForkContext(r, effectiveParams.context)) :
    undefined;

    const execData = {
      params: effectiveParams,
      effectiveCwd,
      ctx,
      signal,
      onUpdate: onUpdateWithContext,
      agents,
      runId,
      shareEnabled,
      sessionRoot,
      sessionDirForIndex,
      sessionFileForIndex: childSessionFileForIndex,
      artifactConfig,
      artifactsDir,
      backgroundRequestedWhileClarifying,
      effectiveAsync,
      controlConfig,
      intercomBridge
    };

    const foregroundMode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
    const foregroundControl = effectiveAsync ?
    undefined :
    {
      runId,
      mode: foregroundMode,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      currentAgent: undefined,
      currentIndex: undefined,
      currentActivityState: undefined,
      interrupt: undefined
    };
    if (foregroundControl) {
      deps.state.foregroundControls.set(runId, foregroundControl);
      deps.state.lastForegroundControlId = runId;
    }

    try {
      const asyncResult = runAsyncPath(execData, deps);
      if (asyncResult) return withForkContext(asyncResult, effectiveParams.context);
      if (hasChain && effectiveParams.chain) return withForkContext(await runChainPath(execData, deps), effectiveParams.context);
      if (hasTasks && effectiveParams.tasks) return withForkContext(await runParallelPath(execData, deps), effectiveParams.context);
      if (hasSingle) return withForkContext(await runSinglePath(execData, deps), effectiveParams.context);
    } catch (error) {
      return toExecutionErrorResult(effectiveParams, error);
    } finally {
      if (foregroundControl) {
        (0, _controlNotices.clearPendingForegroundControlNotices)(deps.state, runId);
        deps.state.foregroundControls.delete(runId);
        if (deps.state.lastForegroundControlId === runId) {
          deps.state.lastForegroundControlId = null;
        }
      }
    }

    return withForkContext({
      content: [{ type: "text", text: "Invalid params" }],
      isError: true,
      details: { mode: "single", results: [] }
    }, effectiveParams.context);
  };

  return { execute };
} /* v9-c7a1289a50ce9121 */
