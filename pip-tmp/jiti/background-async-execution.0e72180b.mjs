"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.executeAsyncChain = executeAsyncChain;exports.executeAsyncSingle = executeAsyncSingle;exports.formatAsyncStartedMessage = formatAsyncStartedMessage;exports.isAsyncAvailable = isAsyncAvailable;



var _nodeChild_process = await jitiImport("node:child_process");
var fs = _interopRequireWildcard(await jitiImport("node:fs"));

var path = _interopRequireWildcard(await jitiImport("node:path"));
var _nodeUrl = await jitiImport("node:url");
var _nodeModule = await jitiImport("node:module");


var _piArgs = await jitiImport("../shared/pi-args.ts");
var _singleOutput = await jitiImport("../shared/single-output.ts");
var _settings = await jitiImport("../../shared/settings.ts");

var _piSpawn = await jitiImport("../shared/pi-spawn.ts");
var _skills = await jitiImport("../../agents/skills.ts");
var _utils = await jitiImport("../../shared/utils.ts");
var _modelFallback = await jitiImport("../shared/model-fallback.ts");
var _worktree = await jitiImport("../shared/worktree.ts");
var _types = await jitiImport("../../shared/types.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);} /**
 * Async execution logic for subagent tool
 */











const _require = (0, _nodeModule.createRequire)("file:///home/edwin/.config/nvm/versions/node/v22.20.0/lib/node_modules/pi-subagents/src/runs/background/async-execution.ts");
const piPackageRoot = (0, _piSpawn.resolvePiPackageRoot)();
const jitiCliPath = (() => {
  const candidates = [
  () => path.join(path.dirname(_require.resolve("jiti/package.json")), "lib/jiti-cli.mjs"),
  () => path.join(path.dirname(_require.resolve("@mariozechner/jiti/package.json")), "lib/jiti-cli.mjs"),
  () => {
    const piEntry = fs.realpathSync(process.argv[1]);
    const piRequire = (0, _nodeModule.createRequire)(piEntry);
    return path.join(path.dirname(piRequire.resolve("@mariozechner/jiti/package.json")), "lib/jiti-cli.mjs");
  }];

  for (const candidate of candidates) {
    try {
      const p = candidate();
      if (fs.existsSync(p)) return p;
    } catch {

      // Candidate not available in this install, continue probing.
    }}
  return undefined;
})();






























































function formatAsyncStartedMessage(headline) {
  return [
  headline,
  "",
  "The async run is detached. Do not run sleep timers or polling loops just to wait for it.",
  "If you have independent work, continue that work. If you have nothing else to do until the async result arrives, end your turn now; Pi will deliver the completion when the run finishes.",
  "Use subagent({ action: \"status\", id: \"...\" }) when you need the current status/result, or to inspect a blocked/stale run. Do not poll just to wait."].
  join("\n");
}

/**
 * Check if jiti is available for async execution
 */
function isAsyncAvailable() {
  return jitiCliPath !== undefined;
}

/**
 * Spawn the async runner process
 */
function spawnRunner(cfg, suffix, cwd) {
  if (!jitiCliPath) {
    return { error: "jiti for TypeScript execution could not be found" };
  }

  try {
    const cwdStats = fs.statSync(cwd);
    if (!cwdStats.isDirectory()) {
      return { error: `cwd is not a directory: ${cwd}` };
    }
  } catch {
    return { error: `cwd does not exist: ${cwd}` };
  }

  fs.mkdirSync(_types.TEMP_ROOT_DIR, { recursive: true });
  const cfgPath = (0, _types.getAsyncConfigPath)(suffix);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const runner = path.join(path.dirname((0, _nodeUrl.fileURLToPath)("file:///home/edwin/.config/nvm/versions/node/v22.20.0/lib/node_modules/pi-subagents/src/runs/background/async-execution.ts")), "subagent-runner.ts");

  const proc = (0, _nodeChild_process.spawn)(process.execPath, [jitiCliPath, runner, cfgPath], {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  proc.on("error", (error) => {
    console.error(`[pi-subagents] async spawn failed: ${error.message}`);
  });
  if (typeof proc.pid !== "number") {
    return { error: `async runner did not produce a pid for cwd: ${cwd}` };
  }
  proc.unref();
  return { pid: proc.pid };
}

function formatAsyncStartError(mode, message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    details: { mode, results: [] }
  };
}

const UNAVAILABLE_SUBAGENT_SKILL_ERROR = "Skills not found: pi-subagents";

class UnavailableSubagentSkillError extends Error {}
class AsyncStartValidationError extends Error {}

/**
 * Execute a chain asynchronously
 */
function executeAsyncChain(
id,
params)
{
  const {
    chain,
    agents,
    ctx,
    cwd,
    maxOutput,
    artifactsDir,
    artifactConfig,
    shareEnabled,
    sessionRoot,
    sessionFilesByFlatIndex,
    maxSubagentDepth,
    worktreeSetupHook,
    worktreeSetupHookTimeoutMs,
    controlConfig,
    controlIntercomTarget,
    childIntercomTarget
  } = params;
  const resultMode = params.resultMode ?? "chain";
  const chainSkills = params.chainSkills ?? [];
  const availableModels = params.availableModels;
  const runnerCwd = (0, _utils.resolveChildCwd)(ctx.cwd, cwd);
  const firstStep = chain[0];
  const originalTask = params.task ?? (firstStep ?
  (0, _settings.isParallelStep)(firstStep) ? firstStep.parallel[0]?.task : firstStep.task :
  undefined);

  for (const s of chain) {
    const stepAgents = (0, _settings.isParallelStep)(s) ?
    s.parallel.map((t) => t.agent) :
    [s.agent];
    for (const agentName of stepAgents) {
      if (!agents.find((x) => x.name === agentName)) {
        return {
          content: [{ type: "text", text: `Unknown agent: ${agentName}` }],
          isError: true,
          details: { mode: resultMode, results: [] }
        };
      }
    }
  }

  const asyncDir = path.join(_types.ASYNC_DIR, id);
  try {
    fs.mkdirSync(asyncDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
      isError: true,
      details: { mode: resultMode, results: [] }
    };
  }

  let progressInstructionCreated = false;
  const buildStepOverrides = (s) => {
    const stepSkillInput = (0, _skills.normalizeSkillInput)(s.skill);
    return {
      ...(s.output !== undefined ? { output: s.output } : {}),
      ...(s.outputMode !== undefined ? { outputMode: s.outputMode } : {}),
      ...(s.reads !== undefined ? { reads: s.reads } : {}),
      ...(s.progress !== undefined ? { progress: s.progress } : {}),
      ...(stepSkillInput !== undefined ? { skills: stepSkillInput } : {}),
      ...(s.model ? { model: s.model } : {})
    };
  };
  const buildSeqStep = (s, sessionFile, behaviorCwd, progressPrecreated = false, resolvedBehavior) => {
    const a = agents.find((x) => x.name === s.agent);
    const stepCwd = (0, _utils.resolveChildCwd)(runnerCwd, s.cwd);
    const instructionCwd = behaviorCwd ?? stepCwd;
    const behavior = (0, _settings.suppressProgressForReadOnlyTask)(resolvedBehavior ?? (0, _settings.resolveStepBehavior)(a, buildStepOverrides(s), chainSkills), s.task, originalTask);
    const skillNames = behavior.skills === false ? [] : behavior.skills;
    const { resolved: resolvedSkills, missing: missingSkills } = (0, _skills.resolveSkillsWithFallback)(skillNames, stepCwd, ctx.cwd);
    if (missingSkills.includes("pi-subagents")) throw new UnavailableSubagentSkillError(UNAVAILABLE_SUBAGENT_SKILL_ERROR);

    let systemPrompt = a.systemPrompt?.trim() ?? "";
    if (resolvedSkills.length > 0) {
      const injection = (0, _skills.buildSkillInjection)(resolvedSkills);
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
    }

    const readInstructions = (0, _settings.buildChainInstructions)({ ...behavior, output: false, progress: false }, instructionCwd, false);
    const isFirstProgressAgent = behavior.progress && !progressPrecreated && !progressInstructionCreated;
    if (behavior.progress) progressInstructionCreated = true;
    const progressInstructions = (0, _settings.buildChainInstructions)({ ...behavior, output: false, reads: false }, runnerCwd, isFirstProgressAgent);
    const outputPath = (0, _singleOutput.resolveSingleOutputPath)(behavior.output, ctx.cwd, instructionCwd);
    const validationError = (0, _singleOutput.validateFileOnlyOutputMode)(behavior.outputMode, outputPath, `Async step (${s.agent})`);
    if (validationError) throw new AsyncStartValidationError(validationError);
    const task = (0, _singleOutput.injectSingleOutputInstruction)(`${readInstructions.prefix}${s.task ?? "{previous}"}${progressInstructions.suffix}`, outputPath);

    const primaryModel = (0, _modelFallback.resolveModelCandidate)(behavior.model ?? a.model, availableModels, ctx.currentModelProvider);
    return {
      agent: s.agent,
      task,
      cwd: stepCwd,
      model: (0, _piArgs.applyThinkingSuffix)(primaryModel, a.thinking),
      modelCandidates: (0, _modelFallback.buildModelCandidates)(behavior.model ?? a.model, a.fallbackModels, availableModels, ctx.currentModelProvider).map((candidate) =>
      (0, _piArgs.applyThinkingSuffix)(candidate, a.thinking)
      ),
      tools: a.tools,
      extensions: a.extensions,
      mcpDirectTools: a.mcpDirectTools,
      systemPrompt,
      systemPromptMode: a.systemPromptMode,
      inheritProjectContext: a.inheritProjectContext,
      inheritSkills: a.inheritSkills,
      skills: resolvedSkills.map((r) => r.name),
      outputPath,
      outputMode: behavior.outputMode,
      sessionFile,
      maxSubagentDepth: (0, _types.resolveChildMaxSubagentDepth)(maxSubagentDepth, a.maxSubagentDepth)
    };
  };

  let flatStepIndex = 0;
  const nextSessionFile = () => {
    const sessionFile = sessionFilesByFlatIndex?.[flatStepIndex];
    flatStepIndex++;
    return sessionFile;
  };

  let steps;
  try {
    steps = chain.map((s, stepIndex) => {
      if ((0, _settings.isParallelStep)(s)) {
        const parallelBehaviors = s.parallel.map((task) => {
          const agent = agents.find((candidate) => candidate.name === task.agent);
          return (0, _settings.suppressProgressForReadOnlyTask)((0, _settings.resolveStepBehavior)(agent, buildStepOverrides(task), chainSkills), task.task, originalTask);
        });
        const progressPrecreated = parallelBehaviors.some((behavior) => behavior.progress);
        if (progressPrecreated) {
          if (!s.worktree) (0, _settings.writeInitialProgressFile)(runnerCwd);
          progressInstructionCreated = true;
        }
        return {
          parallel: s.parallel.map((t, taskIndex) => {
            let behaviorCwd;
            if (s.worktree) {
              try {
                behaviorCwd = (0, _worktree.resolveExpectedWorktreeAgentCwd)(runnerCwd, `${id}-s${stepIndex}`, taskIndex);
              } catch {
                behaviorCwd = undefined;
              }
            }
            return buildSeqStep(t, nextSessionFile(), behaviorCwd, progressPrecreated, parallelBehaviors[taskIndex]);
          }),
          concurrency: s.concurrency,
          failFast: s.failFast,
          worktree: s.worktree
        };
      }
      return buildSeqStep(s, nextSessionFile());
    });
  } catch (error) {
    if (error instanceof UnavailableSubagentSkillError || error instanceof AsyncStartValidationError) return formatAsyncStartError(resultMode, error.message);
    throw error;
  }
  let childTargetIndex = 0;
  const childIntercomTargets = childIntercomTarget ? steps.flatMap((step) => {
    if ("parallel" in step) {
      return step.parallel.map((task) => childIntercomTarget(task.agent, childTargetIndex++));
    }
    return [childIntercomTarget(step.agent, childTargetIndex++)];
  }) : undefined;

  let spawnResult = {};
  try {
    spawnResult = spawnRunner(
      {
        id,
        steps,
        resultPath: path.join(_types.RESULTS_DIR, `${id}.json`),
        cwd: runnerCwd,
        placeholder: "{previous}",
        maxOutput,
        artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
        artifactConfig,
        share: shareEnabled,
        sessionDir: sessionRoot ? path.join(sessionRoot, `async-${id}`) : undefined,
        asyncDir,
        sessionId: ctx.currentSessionId,
        piPackageRoot,
        piArgv1: process.argv[1],
        worktreeSetupHook,
        worktreeSetupHookTimeoutMs,
        controlConfig,
        controlIntercomTarget,
        childIntercomTargets,
        resultMode
      },
      id,
      runnerCwd
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatAsyncStartError(resultMode, `Failed to start async ${resultMode} '${id}': ${message}`);
  }

  if (spawnResult.error) {
    return formatAsyncStartError(resultMode, `Failed to start async ${resultMode} '${id}': ${spawnResult.error}`);
  }

  if (spawnResult.pid) {
    const firstStep = chain[0];
    const firstAgents = (0, _settings.isParallelStep)(firstStep) ?
    firstStep.parallel.map((t) => t.agent) :
    [firstStep.agent];
    const parallelGroups = [];
    const flatAgents = [];
    let flatStepStart = 0;
    for (let stepIndex = 0; stepIndex < chain.length; stepIndex++) {
      const step = chain[stepIndex];
      if ((0, _settings.isParallelStep)(step)) {
        parallelGroups.push({ start: flatStepStart, count: step.parallel.length, stepIndex });
        flatAgents.push(...step.parallel.map((task) => task.agent));
        flatStepStart += step.parallel.length;
      } else {
        flatAgents.push(step.agent);
        flatStepStart++;
      }
    }
    ctx.pi.events.emit(_types.SUBAGENT_ASYNC_STARTED_EVENT, {
      id,
      pid: spawnResult.pid,
      sessionId: ctx.currentSessionId,
      mode: resultMode,
      agent: firstAgents[0],
      agents: flatAgents,
      task: (0, _settings.isParallelStep)(firstStep) ?
      firstStep.parallel[0]?.task?.slice(0, 50) :
      firstStep.task?.slice(0, 50),
      chain: chain.map((s) =>
      (0, _settings.isParallelStep)(s) ? `[${s.parallel.map((t) => t.agent).join("+")}]` : s.agent
      ),
      chainStepCount: chain.length,
      parallelGroups,
      cwd: runnerCwd,
      asyncDir
    });
  }

  const chainDesc = chain.
  map((s) =>
  (0, _settings.isParallelStep)(s) ? `[${s.parallel.map((t) => t.agent).join("+")}]` : s.agent
  ).
  join(" -> ");

  return {
    content: [{ type: "text", text: formatAsyncStartedMessage(`Async ${resultMode}: ${chainDesc} [${id}]`) }],
    details: { mode: resultMode, runId: id, results: [], asyncId: id, asyncDir }
  };
}

/**
 * Execute a single agent asynchronously
 */
function executeAsyncSingle(
id,
params)
{
  const {
    agent,
    agentConfig,
    ctx,
    cwd,
    maxOutput,
    artifactsDir,
    artifactConfig,
    shareEnabled,
    sessionRoot,
    sessionFile,
    maxSubagentDepth,
    worktreeSetupHook,
    worktreeSetupHookTimeoutMs,
    controlConfig,
    controlIntercomTarget,
    childIntercomTarget
  } = params;
  const task = params.task ?? "";
  const runnerCwd = (0, _utils.resolveChildCwd)(ctx.cwd, cwd);
  const skillNames = params.skills ?? agentConfig.skills ?? [];
  const availableModels = params.availableModels;
  const { resolved: resolvedSkills, missing: missingSkills } = (0, _skills.resolveSkillsWithFallback)(skillNames, runnerCwd, ctx.cwd);
  if (missingSkills.includes("pi-subagents")) return formatAsyncStartError("single", UNAVAILABLE_SUBAGENT_SKILL_ERROR);
  let systemPrompt = agentConfig.systemPrompt?.trim() ?? "";
  if (resolvedSkills.length > 0) {
    const injection = (0, _skills.buildSkillInjection)(resolvedSkills);
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${injection}` : injection;
  }

  const asyncDir = path.join(_types.ASYNC_DIR, id);
  try {
    fs.mkdirSync(asyncDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Failed to create async run directory '${asyncDir}': ${message}` }],
      isError: true,
      details: { mode: "single", results: [] }
    };
  }

  const outputPath = (0, _singleOutput.resolveSingleOutputPath)(params.output, ctx.cwd, runnerCwd);
  const outputMode = params.outputMode ?? "inline";
  const validationError = (0, _singleOutput.validateFileOnlyOutputMode)(outputMode, outputPath, `Async single run (${agent})`);
  if (validationError) return formatAsyncStartError("single", validationError);
  const taskWithOutputInstruction = (0, _singleOutput.injectSingleOutputInstruction)(task, outputPath);
  let spawnResult = {};
  try {
    spawnResult = spawnRunner(
      {
        id,
        steps: [
        {
          agent,
          task: taskWithOutputInstruction,
          cwd: runnerCwd,
          model: (0, _piArgs.applyThinkingSuffix)((0, _modelFallback.resolveModelCandidate)(params.modelOverride ?? agentConfig.model, availableModels, ctx.currentModelProvider), agentConfig.thinking),
          modelCandidates: (0, _modelFallback.buildModelCandidates)(params.modelOverride ?? agentConfig.model, agentConfig.fallbackModels, availableModels, ctx.currentModelProvider).map((candidate) =>
          (0, _piArgs.applyThinkingSuffix)(candidate, agentConfig.thinking)
          ),
          tools: agentConfig.tools,
          extensions: agentConfig.extensions,
          mcpDirectTools: agentConfig.mcpDirectTools,
          systemPrompt,
          systemPromptMode: agentConfig.systemPromptMode,
          inheritProjectContext: agentConfig.inheritProjectContext,
          inheritSkills: agentConfig.inheritSkills,
          skills: resolvedSkills.map((r) => r.name),
          outputPath,
          outputMode,
          sessionFile,
          maxSubagentDepth: (0, _types.resolveChildMaxSubagentDepth)(maxSubagentDepth, agentConfig.maxSubagentDepth)
        }],

        resultPath: path.join(_types.RESULTS_DIR, `${id}.json`),
        cwd: runnerCwd,
        placeholder: "{previous}",
        maxOutput,
        artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
        artifactConfig,
        share: shareEnabled,
        sessionDir: sessionRoot ? path.join(sessionRoot, `async-${id}`) : undefined,
        asyncDir,
        sessionId: ctx.currentSessionId,
        piPackageRoot,
        piArgv1: process.argv[1],
        worktreeSetupHook,
        worktreeSetupHookTimeoutMs,
        controlConfig,
        controlIntercomTarget,
        childIntercomTargets: childIntercomTarget ? [childIntercomTarget(agent, 0)] : undefined,
        resultMode: "single"
      },
      id,
      runnerCwd
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return formatAsyncStartError("single", `Failed to start async run '${id}': ${message}`);
  }

  if (spawnResult.error) {
    return formatAsyncStartError("single", `Failed to start async run '${id}': ${spawnResult.error}`);
  }

  if (spawnResult.pid) {
    ctx.pi.events.emit(_types.SUBAGENT_ASYNC_STARTED_EVENT, {
      id,
      pid: spawnResult.pid,
      sessionId: ctx.currentSessionId,
      mode: "single",
      agent,
      task: task?.slice(0, 50),
      cwd: runnerCwd,
      asyncDir
    });
  }

  return {
    content: [{ type: "text", text: formatAsyncStartedMessage(`Async: ${agent} [${id}]`) }],
    details: { mode: "single", runId: id, results: [], asyncId: id, asyncDir }
  };
} /* v9-4e5f8b1d7a19d9c5 */
