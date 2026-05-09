"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.executeChain = executeChain;



var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));



var _chainClarify = await jitiImport("./chain-clarify.ts");
var _modelInfo = await jitiImport("../../shared/model-info.ts");
var _settings = await jitiImport("../../shared/settings.ts");


















var _skills = await jitiImport("../../agents/skills.ts");
var _intercomBridge = await jitiImport("../../intercom/intercom-bridge.ts");
var _execution = await jitiImport("./execution.ts");
var _formatters = await jitiImport("../../shared/formatters.ts");
var _utils = await jitiImport("../../shared/utils.ts");
var _runHistory = await jitiImport("../shared/run-history.ts");
var _worktree = await jitiImport("../shared/worktree.ts");








var _types = await jitiImport("../../shared/types.ts");












var _modelFallback = await jitiImport("../shared/model-fallback.ts");
var _singleOutput = await jitiImport("../shared/single-output.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);} /**
 * Chain execution logic for subagent tool
 */






















































function buildChainExecutionDetails(input) {
  return (0, _utils.compactForegroundDetails)({
    mode: "chain",
    results: input.results,
    progress: input.includeProgress ? input.allProgress : undefined,
    artifacts: input.allArtifactPaths.length ? { dir: input.artifactsDir, files: input.allArtifactPaths } : undefined,
    chainAgents: input.chainAgents,
    totalSteps: input.totalSteps,
    currentStepIndex: input.currentStepIndex
  });
}

function buildChainExecutionErrorResult(message, input) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    details: buildChainExecutionDetails(input)
  };
}

function ensureParallelProgressFile(
chainDir,
progressCreated,
parallelBehaviors)
{
  if (progressCreated || !parallelBehaviors.some((behavior) => behavior.progress)) {
    return progressCreated;
  }
  (0, _settings.writeInitialProgressFile)(chainDir);
  return true;
}

function appendParallelWorktreeSummary(
output,
worktreeSetup,
diffsDir,
agents)
{
  if (!worktreeSetup) return output;
  const diffs = (0, _worktree.diffWorktrees)(worktreeSetup, agents, diffsDir);
  const diffSummary = (0, _worktree.formatWorktreeDiffSummary)(diffs);
  if (!diffSummary) return output;
  return `${output}\n\n${diffSummary}`;
}

async function runParallelChainTasks(input) {
  const concurrency = input.step.concurrency ?? _types.MAX_CONCURRENCY;
  const failFast = input.step.failFast ?? false;
  let aborted = false;

  const parallelResults = await (0, _utils.mapConcurrent)(
    input.step.parallel,
    concurrency,
    async (task, taskIndex) => {
      if (aborted && failFast) {
        return {
          agent: task.agent,
          task: "(skipped)",
          exitCode: -1,
          messages: [],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
          error: "Skipped due to fail-fast"
        };
      }

      const taskTemplate = input.parallelTemplates[taskIndex] ?? "{previous}";
      const behavior = (0, _settings.suppressProgressForReadOnlyTask)(input.parallelBehaviors[taskIndex], taskTemplate, input.originalTask);
      const templateHasPrevious = taskTemplate.includes("{previous}");
      const { prefix, suffix } = (0, _settings.buildChainInstructions)(
        behavior,
        input.chainDir,
        false,
        templateHasPrevious ? undefined : input.prev
      );

      let taskStr = taskTemplate;
      taskStr = taskStr.replace(/\{task\}/g, input.originalTask);
      taskStr = taskStr.replace(/\{previous\}/g, input.prev);
      taskStr = taskStr.replace(/\{chain_dir\}/g, input.chainDir);
      const cleanTask = taskStr;
      taskStr = prefix + taskStr + suffix;

      const taskAgentConfig = input.agents.find((agent) => agent.name === task.agent);
      const effectiveModel =
      (task.model ? (0, _modelFallback.resolveModelCandidate)(task.model, input.availableModels, input.ctx.model?.provider) : null) ??
      (0, _modelFallback.resolveModelCandidate)(taskAgentConfig?.model, input.availableModels, input.ctx.model?.provider);
      const maxSubagentDepth = (0, _types.resolveChildMaxSubagentDepth)(input.maxSubagentDepth, taskAgentConfig?.maxSubagentDepth);

      const taskCwd = input.worktreeSetup ?
      input.worktreeSetup.worktrees[taskIndex].agentCwd :
      (0, _utils.resolveChildCwd)(input.cwd ?? input.ctx.cwd, task.cwd);

      const outputPath = typeof behavior.output === "string" ?
      path.isAbsolute(behavior.output) ? behavior.output : path.join(input.chainDir, behavior.output) :
      undefined;
      const interruptController = new AbortController();
      if (input.foregroundControl) {
        input.foregroundControl.currentAgent = task.agent;
        input.foregroundControl.currentIndex = input.globalTaskIndex + taskIndex;
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

      const result = await (0, _execution.runSync)(input.ctx.cwd, input.agents, task.agent, taskStr, {
        cwd: taskCwd,
        signal: input.signal,
        interruptSignal: interruptController.signal,
        allowIntercomDetach: taskAgentConfig?.systemPrompt?.includes(_intercomBridge.INTERCOM_BRIDGE_MARKER) === true,
        intercomEvents: input.intercomEvents,
        runId: input.runId,
        index: input.globalTaskIndex + taskIndex,
        sessionDir: input.sessionDirForIndex(input.globalTaskIndex + taskIndex),
        sessionFile: input.sessionFileForIndex?.(input.globalTaskIndex + taskIndex),
        share: input.shareEnabled,
        artifactsDir: input.artifactConfig.enabled ? input.artifactsDir : undefined,
        artifactConfig: input.artifactConfig,
        outputPath,
        outputMode: behavior.outputMode,
        maxSubagentDepth,
        controlConfig: input.controlConfig,
        onControlEvent: input.onControlEvent,
        intercomSessionName: input.childIntercomTarget?.(task.agent, input.globalTaskIndex + taskIndex),
        orchestratorIntercomTarget: input.orchestratorIntercomTarget,
        modelOverride: effectiveModel,
        availableModels: input.availableModels,
        preferredModelProvider: input.ctx.model?.provider,
        skills: behavior.skills === false ? [] : behavior.skills,
        onUpdate: input.onUpdate ?
        (progressUpdate) => {
          const stepResults = progressUpdate.details?.results || [];
          const stepProgress = progressUpdate.details?.progress || [];
          if (input.foregroundControl && stepProgress.length > 0) {
            const current = stepProgress[0];
            input.foregroundControl.currentAgent = task.agent;
            input.foregroundControl.currentIndex = input.globalTaskIndex + taskIndex;
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
          input.onUpdate?.({
            ...progressUpdate,
            details: {
              mode: "chain",
              results: input.results.concat(stepResults),
              progress: input.allProgress.concat(stepProgress),
              controlEvents: progressUpdate.details?.controlEvents,
              chainAgents: input.chainAgents,
              totalSteps: input.totalSteps,
              currentStepIndex: input.stepIndex
            }
          });
        } :
        undefined
      });
      if (input.foregroundControl?.currentIndex === input.globalTaskIndex + taskIndex) {
        input.foregroundControl.interrupt = undefined;
        input.foregroundControl.updatedAt = Date.now();
      }

      if (result.exitCode !== 0 && failFast) {
        aborted = true;
      }
      (0, _runHistory.recordRun)(task.agent, cleanTask, result.exitCode, result.progressSummary?.durationMs ?? 0);
      return result;
    }
  );

  return parallelResults;
}


















































/**
 * Execute a chain of subagent steps
 */
async function executeChain(params) {
  const {
    chain: chainSteps,
    agents,
    ctx,
    signal,
    runId,
    cwd,
    shareEnabled,
    sessionDirForIndex,
    sessionFileForIndex,
    artifactsDir,
    artifactConfig,
    includeProgress,
    clarify,
    onUpdate,
    onControlEvent,
    controlConfig,
    childIntercomTarget,
    orchestratorIntercomTarget,
    foregroundControl,
    intercomEvents,
    chainSkills: chainSkillsParam,
    chainDir: chainDirBase
  } = params;
  const chainSkills = chainSkillsParam ?? [];

  const allProgress = [];
  const allArtifactPaths = [];

  const chainAgents = chainSteps.map((step) =>
  (0, _settings.isParallelStep)(step) ?
  `[${step.parallel.map((t) => t.agent).join("+")}]` :
  step.agent
  );
  const totalSteps = chainSteps.length;

  const firstStep = chainSteps[0];
  const originalTask = params.task ?? (
  (0, _settings.isParallelStep)(firstStep) ? firstStep.parallel[0].task : firstStep.task);

  const chainDir = (0, _settings.createChainDir)(runId, chainDirBase);
  const hasParallelSteps = chainSteps.some(_settings.isParallelStep);
  let templates = (0, _settings.resolveChainTemplates)(chainSteps);
  const shouldClarify = clarify !== false && ctx.hasUI && !hasParallelSteps;
  let tuiBehaviorOverrides;
  const availableModels = ctx.modelRegistry.getAvailable().map(_modelInfo.toModelInfo);
  const availableSkills = (0, _skills.discoverAvailableSkills)(cwd ?? ctx.cwd);

  if (shouldClarify) {
    const seqSteps = chainSteps;
    const agentConfigs = [];
    for (const step of seqSteps) {
      const config = agents.find((a) => a.name === step.agent);
      if (!config) {
        (0, _settings.removeChainDir)(chainDir);
        return {
          content: [{ type: "text", text: `Unknown agent: ${step.agent}` }],
          isError: true,
          details: { mode: "chain", results: [] }
        };
      }
      agentConfigs.push(config);
    }

    const stepOverrides = seqSteps.map((step) => ({
      output: step.output,
      outputMode: step.outputMode,
      reads: step.reads,
      progress: step.progress,
      skills: (0, _skills.normalizeSkillInput)(step.skill),
      model: step.model
    }));

    const resolvedBehaviors = agentConfigs.map((config, i) =>
    (0, _settings.resolveStepBehavior)(config, stepOverrides[i], chainSkills)
    );
    const flatTemplates = templates;

    const result = await ctx.ui.custom(
      (tui, theme, _kb, done) =>
      new _chainClarify.ChainClarifyComponent(
        tui,
        theme,
        agentConfigs,
        flatTemplates,
        originalTask,
        chainDir,
        resolvedBehaviors,
        availableModels,
        ctx.model?.provider,
        availableSkills,
        done
      ),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 84, maxHeight: "80%" }
      }
    );

    if (!result || !result.confirmed) {
      (0, _settings.removeChainDir)(chainDir);
      return {
        content: [{ type: "text", text: "Chain cancelled" }],
        details: { mode: "chain", results: [] }
      };
    }

    if (result.runInBackground) {
      (0, _settings.removeChainDir)(chainDir);
      const updatedChain = chainSteps.map((step, i) => {
        if ((0, _settings.isParallelStep)(step)) return step;
        const override = result.behaviorOverrides[i];
        return {
          ...step,
          task: result.templates[i],
          ...(override?.model ? { model: override.model } : {}),
          ...(override?.output !== undefined ? { output: override.output } : {}),
          ...("outputMode" in step && step.outputMode !== undefined ? { outputMode: step.outputMode } : {}),
          ...(override?.reads !== undefined ? { reads: override.reads } : {}),
          ...(override?.progress !== undefined ? { progress: override.progress } : {}),
          ...(override?.skills !== undefined ? { skill: override.skills } : {})
        };
      });
      return {
        content: [{ type: "text", text: "Launching in background..." }],
        details: { mode: "chain", results: [] },
        requestedAsync: { chain: updatedChain, chainSkills }
      };
    }

    templates = result.templates;
    tuiBehaviorOverrides = result.behaviorOverrides;
  }

  const results = [];
  let prev = "";
  let globalTaskIndex = 0;
  let progressCreated = false;

  for (let stepIndex = 0; stepIndex < chainSteps.length; stepIndex++) {
    const step = chainSteps[stepIndex];
    const stepTemplates = templates[stepIndex];

    if ((0, _settings.isParallelStep)(step)) {
      const parallelTemplates = stepTemplates;
      const parallelCwd = (0, _utils.resolveChildCwd)(cwd ?? ctx.cwd, step.cwd);
      let worktreeSetup;
      if (step.worktree) {
        const worktreeTaskCwdConflict = (0, _worktree.findWorktreeTaskCwdConflict)(step.parallel, parallelCwd);
        if (worktreeTaskCwdConflict) {
          return buildChainExecutionErrorResult(
            `parallel chain step ${stepIndex + 1}: ${(0, _worktree.formatWorktreeTaskCwdConflict)(worktreeTaskCwdConflict, parallelCwd)}`,
            {
              results,
              includeProgress,
              allProgress,
              allArtifactPaths,
              artifactsDir,
              chainAgents,
              totalSteps,
              currentStepIndex: stepIndex
            }
          );
        }
        try {
          worktreeSetup = (0, _worktree.createWorktrees)(parallelCwd, `${runId}-s${stepIndex}`, step.parallel.length, {
            agents: step.parallel.map((task) => task.agent),
            setupHook: params.worktreeSetupHook ?
            { hookPath: params.worktreeSetupHook, timeoutMs: params.worktreeSetupHookTimeoutMs } :
            undefined
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return buildChainExecutionErrorResult(message, {
            results,
            includeProgress,
            allProgress,
            allArtifactPaths,
            artifactsDir,
            chainAgents,
            totalSteps,
            currentStepIndex: stepIndex
          });
        }
      }

      try {
        const agentNames = step.parallel.map((task) => task.agent);
        const parallelBehaviors = (0, _settings.resolveParallelBehaviors)(step.parallel, agents, stepIndex, chainSkills).
        map((behavior, taskIndex) => (0, _settings.suppressProgressForReadOnlyTask)(behavior, parallelTemplates[taskIndex] ?? step.parallel[taskIndex]?.task, originalTask));
        for (let taskIndex = 0; taskIndex < step.parallel.length; taskIndex++) {
          const behavior = parallelBehaviors[taskIndex];
          const outputPath = typeof behavior.output === "string" ?
          path.isAbsolute(behavior.output) ? behavior.output : path.join(chainDir, behavior.output) :
          undefined;
          const validationError = (0, _singleOutput.validateFileOnlyOutputMode)(behavior.outputMode, outputPath, `Parallel chain step ${stepIndex + 1} task ${taskIndex + 1} (${step.parallel[taskIndex].agent})`);
          if (validationError) return buildChainExecutionErrorResult(validationError, {
            results,
            includeProgress,
            allProgress,
            allArtifactPaths,
            artifactsDir,
            chainAgents,
            totalSteps,
            currentStepIndex: stepIndex
          });
        }
        progressCreated = ensureParallelProgressFile(chainDir, progressCreated, parallelBehaviors);
        (0, _settings.createParallelDirs)(chainDir, stepIndex, step.parallel.length, agentNames);

        const parallelResults = await runParallelChainTasks({
          step,
          parallelTemplates,
          parallelBehaviors,
          agents,
          stepIndex,
          availableModels,
          chainDir,
          prev,
          originalTask,
          ctx,
          intercomEvents,
          cwd,
          runId,
          globalTaskIndex,
          sessionDirForIndex,
          sessionFileForIndex,
          shareEnabled,
          artifactConfig,
          artifactsDir,
          signal,
          onUpdate,
          results,
          allProgress,
          chainAgents,
          totalSteps,
          controlConfig,
          onControlEvent,
          childIntercomTarget,
          orchestratorIntercomTarget,
          foregroundControl,
          worktreeSetup,
          maxSubagentDepth: params.maxSubagentDepth
        });
        globalTaskIndex += step.parallel.length;

        for (const result of parallelResults) {
          results.push(result);
          if (result.progress) allProgress.push(result.progress);
          if (result.artifactPaths) allArtifactPaths.push(result.artifactPaths);
        }

        const interrupted = parallelResults.find((result) => result.interrupted);
        if (interrupted) {
          return {
            content: [{ type: "text", text: `Chain paused after interrupt at step ${stepIndex + 1} (${interrupted.agent}). Waiting for explicit next action.` }],
            details: buildChainExecutionDetails({
              results,
              includeProgress,
              allProgress,
              allArtifactPaths,
              artifactsDir,
              chainAgents,
              totalSteps,
              currentStepIndex: stepIndex
            })
          };
        }
        const detachedIndexInStep = parallelResults.findIndex((result) => result.detached);
        const detached = detachedIndexInStep >= 0 ? parallelResults[detachedIndexInStep] : undefined;
        if (detached) {
          return {
            content: [{ type: "text", text: `Chain detached for intercom coordination at step ${stepIndex + 1} (${detached.agent}). Reply to the supervisor request first. After the child exits, start a fresh follow-up if needed.` }],
            details: buildChainExecutionDetails({
              results,
              includeProgress,
              allProgress,
              allArtifactPaths,
              artifactsDir,
              chainAgents,
              totalSteps,
              currentStepIndex: stepIndex
            })
          };
        }

        const failures = parallelResults.
        map((result, originalIndex) => ({ ...result, originalIndex })).
        filter((result) => result.exitCode !== 0 && result.exitCode !== -1);
        if (failures.length > 0) {
          const failureSummary = failures.
          map((failure) => `- Task ${failure.originalIndex + 1} (${failure.agent}): ${failure.error || "failed"}`).
          join("\n");
          const errorMsg = `Parallel step ${stepIndex + 1} failed:\n${failureSummary}`;
          const summary = (0, _formatters.buildChainSummary)(chainSteps, results, chainDir, "failed", {
            index: stepIndex,
            error: errorMsg
          });
          return {
            content: [{ type: "text", text: summary }],
            isError: true,
            details: buildChainExecutionDetails({
              results,
              includeProgress,
              allProgress,
              allArtifactPaths,
              artifactsDir,
              chainAgents,
              totalSteps,
              currentStepIndex: stepIndex
            })
          };
        }

        const taskResults = parallelResults.map((result, i) => {
          const outputTarget = parallelBehaviors[i]?.output;
          const outputTargetPath = typeof outputTarget === "string" ?
          path.isAbsolute(outputTarget) ? outputTarget : path.join(chainDir, outputTarget) :
          undefined;
          return {
            agent: result.agent,
            taskIndex: i,
            output: (0, _utils.getSingleResultOutput)(result),
            exitCode: result.exitCode,
            error: result.error,
            outputTargetPath,
            outputTargetExists: outputTargetPath ? fs.existsSync(outputTargetPath) : undefined
          };
        });
        prev = (0, _settings.aggregateParallelOutputs)(taskResults);
        prev = appendParallelWorktreeSummary(
          prev,
          worktreeSetup,
          path.join(chainDir, "worktree-diffs", `step-${stepIndex}`),
          agentNames
        );
      } finally {
        if (worktreeSetup) (0, _worktree.cleanupWorktrees)(worktreeSetup);
      }
    } else {
      const seqStep = step;
      const stepTemplate = stepTemplates;

      const agentConfig = agents.find((a) => a.name === seqStep.agent);
      if (!agentConfig) {
        (0, _settings.removeChainDir)(chainDir);
        return {
          content: [{ type: "text", text: `Unknown agent: ${seqStep.agent}` }],
          isError: true,
          details: { mode: "chain", results: [] }
        };
      }

      const tuiOverride = tuiBehaviorOverrides?.[stepIndex];
      const stepOverride = {
        output: tuiOverride?.output !== undefined ? tuiOverride.output : seqStep.output,
        outputMode: seqStep.outputMode,
        reads: tuiOverride?.reads !== undefined ? tuiOverride.reads : seqStep.reads,
        progress: tuiOverride?.progress !== undefined ? tuiOverride.progress : seqStep.progress,
        skills:
        tuiOverride?.skills !== undefined ?
        tuiOverride.skills :
        (0, _skills.normalizeSkillInput)(seqStep.skill)
      };
      const behavior = (0, _settings.suppressProgressForReadOnlyTask)((0, _settings.resolveStepBehavior)(agentConfig, stepOverride, chainSkills), stepTemplate, originalTask);

      const isFirstProgress = behavior.progress && !progressCreated;
      if (isFirstProgress) {
        progressCreated = true;
      }

      const templateHasPrevious = stepTemplate.includes("{previous}");
      const { prefix, suffix } = (0, _settings.buildChainInstructions)(
        behavior,
        chainDir,
        isFirstProgress,
        templateHasPrevious ? undefined : prev
      );

      let stepTask = stepTemplate;
      stepTask = stepTask.replace(/\{task\}/g, originalTask);
      stepTask = stepTask.replace(/\{previous\}/g, prev);
      stepTask = stepTask.replace(/\{chain_dir\}/g, chainDir);
      const cleanTask = stepTask;
      stepTask = prefix + stepTask + suffix;

      const effectiveModel =
      tuiOverride?.model ?? (
      seqStep.model ? (0, _modelFallback.resolveModelCandidate)(seqStep.model, availableModels, ctx.model?.provider) : null) ??
      (0, _modelFallback.resolveModelCandidate)(agentConfig.model, availableModels, ctx.model?.provider);

      const outputPath = typeof behavior.output === "string" ?
      path.isAbsolute(behavior.output) ? behavior.output : path.join(chainDir, behavior.output) :
      undefined;
      const validationError = (0, _singleOutput.validateFileOnlyOutputMode)(behavior.outputMode, outputPath, `Chain step ${stepIndex + 1} (${seqStep.agent})`);
      if (validationError) {
        return buildChainExecutionErrorResult(validationError, {
          results,
          includeProgress,
          allProgress,
          allArtifactPaths,
          artifactsDir,
          chainAgents,
          totalSteps,
          currentStepIndex: stepIndex
        });
      }
      const maxSubagentDepth = (0, _types.resolveChildMaxSubagentDepth)(params.maxSubagentDepth, agentConfig.maxSubagentDepth);
      const interruptController = new AbortController();
      if (foregroundControl) {
        foregroundControl.currentAgent = seqStep.agent;
        foregroundControl.currentIndex = globalTaskIndex;
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

      const r = await (0, _execution.runSync)(ctx.cwd, agents, seqStep.agent, stepTask, {
        cwd: (0, _utils.resolveChildCwd)(cwd ?? ctx.cwd, seqStep.cwd),
        signal,
        interruptSignal: interruptController.signal,
        allowIntercomDetach: agentConfig.systemPrompt?.includes(_intercomBridge.INTERCOM_BRIDGE_MARKER) === true,
        intercomEvents,
        runId,
        index: globalTaskIndex,
        sessionDir: sessionDirForIndex(globalTaskIndex),
        sessionFile: sessionFileForIndex?.(globalTaskIndex),
        share: shareEnabled,
        artifactsDir: artifactConfig.enabled ? artifactsDir : undefined,
        artifactConfig,
        outputPath,
        outputMode: behavior.outputMode,
        maxSubagentDepth,
        controlConfig,
        onControlEvent,
        intercomSessionName: childIntercomTarget?.(seqStep.agent, globalTaskIndex),
        orchestratorIntercomTarget,
        modelOverride: effectiveModel,
        availableModels,
        preferredModelProvider: ctx.model?.provider,
        skills: behavior.skills === false ? [] : behavior.skills,
        onUpdate: onUpdate ?
        (p) => {
          const stepResults = p.details?.results || [];
          const stepProgress = p.details?.progress || [];
          if (foregroundControl && stepProgress.length > 0) {
            const current = stepProgress[0];
            foregroundControl.currentAgent = seqStep.agent;
            foregroundControl.currentIndex = globalTaskIndex;
            foregroundControl.currentActivityState = current?.activityState;
            foregroundControl.lastActivityAt = current?.lastActivityAt;
            foregroundControl.currentTool = current?.currentTool;
            foregroundControl.currentToolStartedAt = current?.currentToolStartedAt;
            foregroundControl.currentPath = current?.currentPath;
            foregroundControl.turnCount = current?.turnCount;
            foregroundControl.tokens = current?.tokens;
            foregroundControl.toolCount = current?.toolCount;
            foregroundControl.updatedAt = Date.now();
          }
          onUpdate({
            ...p,
            details: {
              mode: "chain",
              results: results.concat(stepResults),
              progress: allProgress.concat(stepProgress),
              controlEvents: p.details?.controlEvents,
              chainAgents,
              totalSteps,
              currentStepIndex: stepIndex
            }
          });
        } :
        undefined
      });
      if (foregroundControl?.currentIndex === globalTaskIndex) {
        foregroundControl.interrupt = undefined;
        foregroundControl.updatedAt = Date.now();
      }
      (0, _runHistory.recordRun)(seqStep.agent, cleanTask, r.exitCode, r.progressSummary?.durationMs ?? 0);

      globalTaskIndex++;
      results.push(r);
      if (r.progress) allProgress.push(r.progress);
      if (r.artifactPaths) allArtifactPaths.push(r.artifactPaths);

      if (r.interrupted) {
        return {
          content: [{ type: "text", text: `Chain paused after interrupt at step ${stepIndex + 1} (${r.agent}). Waiting for explicit next action.` }],
          details: buildChainExecutionDetails({
            results,
            includeProgress,
            allProgress,
            allArtifactPaths,
            artifactsDir,
            chainAgents,
            totalSteps,
            currentStepIndex: stepIndex
          })
        };
      }
      if (r.detached) {
        return {
          content: [{ type: "text", text: `Chain detached for intercom coordination at step ${stepIndex + 1} (${r.agent}). Reply to the supervisor request first. After the child exits, start a fresh follow-up if needed.` }],
          details: buildChainExecutionDetails({
            results,
            includeProgress,
            allProgress,
            allArtifactPaths,
            artifactsDir,
            chainAgents,
            totalSteps,
            currentStepIndex: stepIndex
          })
        };
      }

      if (r.exitCode !== 0) {
        const summary = (0, _formatters.buildChainSummary)(chainSteps, results, chainDir, "failed", {
          index: stepIndex,
          error: r.error || "Chain failed"
        });
        return {
          content: [{ type: "text", text: summary }],
          details: buildChainExecutionDetails({
            results,
            includeProgress,
            allProgress,
            allArtifactPaths,
            artifactsDir,
            chainAgents,
            totalSteps,
            currentStepIndex: stepIndex
          }),
          isError: true
        };
      }

      if (behavior.output) {
        try {
          const expectedPath = path.isAbsolute(behavior.output) ?
          behavior.output :
          path.join(chainDir, behavior.output);
          if (!fs.existsSync(expectedPath)) {
            const dirFiles = fs.readdirSync(chainDir);
            const mdFiles = dirFiles.filter((file) => file.endsWith(".md") && file !== "progress.md");
            const warning = mdFiles.length > 0 ?
            `Agent wrote to different file(s): ${mdFiles.join(", ")} instead of ${behavior.output}` :
            `Agent did not create expected output file: ${behavior.output}`;
            r.error = r.error ? `${r.error}\n${warning}` : warning;
          }
        } catch {

          // Ignore validation errors; this diagnostic should not mask successful chain output.
        }}

      prev = (0, _utils.getSingleResultOutput)(r);
    }
  }

  const summary = (0, _formatters.buildChainSummary)(chainSteps, results, chainDir, "completed");

  return {
    content: [{ type: "text", text: summary }],
    details: buildChainExecutionDetails({
      results,
      includeProgress,
      allProgress,
      allArtifactPaths,
      artifactsDir,
      chainAgents,
      totalSteps
    })
  };
} /* v9-cf844499abcaf24e */
