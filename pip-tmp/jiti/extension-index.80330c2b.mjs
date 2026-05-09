"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.default = registerSubagentExtension;













var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var os = _interopRequireWildcard(await jitiImport("node:os"));
var path = _interopRequireWildcard(await jitiImport("node:path"));


var _piTui = await jitiImport("@mariozechner/pi-tui");
var _agents = await jitiImport("../agents/agents.ts");
var _artifacts = await jitiImport("../shared/artifacts.ts");
var _sessionIdentity = await jitiImport("../shared/session-identity.ts");
var _settings = await jitiImport("../shared/settings.ts");
var _render = await jitiImport("../tui/render.ts");
var _schemas = await jitiImport("./schemas.ts");
var _subagentExecutor = await jitiImport("../runs/foreground/subagent-executor.ts");
var _asyncJobTracker = await jitiImport("../runs/background/async-job-tracker.ts");
var _resultWatcher = await jitiImport("../runs/background/result-watcher.ts");
var _slashCommands = await jitiImport("../slash/slash-commands.ts");
var _promptTemplateBridge = await jitiImport("../slash/prompt-template-bridge.ts");
var _slashBridge = await jitiImport("../slash/slash-bridge.ts");
var _slashLiveState = await jitiImport("../slash/slash-live-state.ts");

var _notify = _interopRequireDefault(await jitiImport("../runs/background/notify.ts"));
var _piArgs = await jitiImport("../runs/shared/pi-args.ts");
var _formatters = await jitiImport("../shared/formatters.ts");
var _types = await jitiImport("../shared/types.ts");












var _controlNotices = await jitiImport("./control-notices.ts");function _interopRequireDefault(e) {return e && e.__esModule ? e : { default: e };}function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);} /**
 * Subagent Tool
 *
 * Full-featured subagent with sync and async modes.
 * - Sync (default): Streams output, renders markdown, tracks usage
 * - Async: Background execution, emits events when done
 *
 * Modes: single (agent + task), parallel (tasks[]), chain (chain[] with {previous})
 * Toggle: async parameter (default: false, configurable via config.json)
 *
 * Config file: ~/.pi/agent/extensions/subagent/config.json
 *   { "asyncByDefault": true, "forceTopLevelAsync": true, "maxSubagentDepth": 1, "intercomBridge": { "mode": "always", "instructionFile": "./intercom-bridge.md" }, "worktreeSetupHook": "./scripts/setup-worktree.mjs" }
 */ /**
 * Derive subagent session base directory from parent session file.
 * If parent session is ~/.pi/agent/sessions/abc123.jsonl,
 * returns ~/.pi/agent/sessions/abc123/ as the base.
 * Callers add runId to create the actual session root: abc123/{runId}/
 * Falls back to a unique temp directory if no parent session.
 */function getSubagentSessionRoot(parentSessionFile) {if (parentSessionFile) {const baseName = path.basename(parentSessionFile, ".jsonl");const sessionsDir = path.dirname(parentSessionFile);
    return path.join(sessionsDir, baseName);
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-session-"));
}

function loadConfig() {
  const configPath = path.join(os.homedir(), ".pi", "agent", "extensions", "subagent", "config.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (error) {
    console.error(`Failed to load subagent config from '${configPath}':`, error);
  }
  return {};
}

function expandTilde(p) {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/**
 * Create a directory and verify it is actually accessible.
 * On Windows with Azure AD/Entra ID, directories created shortly after
 * wake-from-sleep can end up with broken NTFS ACLs (null DACL) when the
 * cloud SID cannot be resolved without network connectivity. This leaves
 * the directory completely inaccessible to the creating user.
 */
function ensureAccessibleDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {

      // Best effort: retry mkdir/access even if cleanup fails.
    }fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
  }
}

function isSlashResultRunning(result) {
  return result.details?.progress?.some((entry) => entry.status === "running") ||
  result.details?.results.some((entry) => entry.progress?.status === "running") ||
  false;
}

function isSlashResultError(result) {
  return result.details?.results.some((entry) => entry.exitCode !== 0 && entry.progress?.status !== "running") || false;
}

function isStaleExtensionContextError(error) {
  return error instanceof Error && error.message.includes("Extension context no longer active");
}

function rebuildSlashResultContainer(
container,
result,
options,
theme)
{
  container.clear();
  container.addChild(new _piTui.Spacer(1));
  const boxTheme = isSlashResultRunning(result) ? "toolPendingBg" : isSlashResultError(result) ? "toolErrorBg" : "toolSuccessBg";
  const box = new _piTui.Box(1, 1, (text) => theme.bg(boxTheme, text));
  box.addChild((0, _render.renderSubagentResult)(result, options, theme));
  container.addChild(box);
}

function createSlashResultComponent(
details,
options,
theme,
requestRender)
{
  const container = new _piTui.Container();
  const animationState = {};
  let lastVersion = -1;
  container.render = (width) => {
    const snapshot = (0, _slashLiveState.getSlashRenderableSnapshot)(details);
    (0, _render.syncResultAnimation)(snapshot.result, { state: animationState, invalidate: requestRender });
    if (snapshot.version !== lastVersion || isSlashResultRunning(snapshot.result)) {
      lastVersion = snapshot.version;
      rebuildSlashResultContainer(container, snapshot.result, options, theme);
    }
    return _piTui.Container.prototype.render.call(container, width);
  };
  return container;
}

function parseSubagentNotifyContent(content) {
  const lines = content.split("\n");
  const header = lines[0] ?? "";
  const match = header.match(/^Background task (completed|failed|paused): \*\*(.+?)\*\*(?:\s+(\([^)]*\)))?$/);
  if (!match) return undefined;
  const body = lines.slice(2);
  let sessionIndex = -1;
  for (let i = body.length - 1; i >= 1; i--) {
    if (body[i - 1]?.trim() === "" && /^(Session|Session file|Session share error):\s+/.test(body[i])) {
      sessionIndex = i;
      break;
    }
  }
  const sessionLine = sessionIndex >= 0 ? body[sessionIndex] : undefined;
  const resultLines = sessionIndex >= 0 ? body.slice(0, sessionIndex) : body;
  const resultPreview = resultLines.join("\n").trim() || "(no output)";
  let sessionLabel;
  let sessionValue;
  if (sessionLine) {
    const separator = sessionLine.indexOf(":");
    sessionLabel = sessionLine.slice(0, separator).toLowerCase();
    sessionValue = sessionLine.slice(separator + 1).trim();
  }
  return {
    agent: match[2],
    status: match[1],
    ...(match[3] ? { taskInfo: match[3] } : {}),
    resultPreview,
    ...(sessionLabel && sessionValue ? { sessionLabel, sessionValue } : {})
  };
}

class SubagentControlNoticeComponent {
  constructor(
  details,
  theme)
  {this.details = details;this.theme = theme;}

  invalidate() {}

  render(width) {
    const eventLabel = this.details.event.type.replaceAll("_", " ");
    if (width < 3) return [(0, _piTui.truncateToWidth)(`Subagent ${eventLabel}`, width)];
    const bodyWidth = Math.max(1, width - 2);
    const borderChar = "─";
    const header = ` ⚠ Subagent ${eventLabel}: ${this.details.event.agent} `;
    const headerText = (0, _piTui.truncateToWidth)(header, bodyWidth, "");
    const headerPadding = Math.max(0, bodyWidth - (0, _piTui.visibleWidth)(headerText));
    const lines = [this.theme.fg("accent", `╭${headerText}${borderChar.repeat(headerPadding)}╮`)];

    for (const line of (0, _piTui.wrapTextWithAnsi)((0, _controlNotices.formatSubagentControlNotice)(this.details), bodyWidth)) {
      const text = (0, _piTui.truncateToWidth)(line, bodyWidth, "");
      const padding = Math.max(0, bodyWidth - (0, _piTui.visibleWidth)(text));
      lines.push(this.theme.fg("accent", `│${text}${" ".repeat(padding)}│`));
    }
    lines.push(this.theme.fg("accent", `╰${borderChar.repeat(bodyWidth)}╯`));
    return lines;
  }
}

function registerSubagentExtension(pi) {
  if (process.env[_piArgs.SUBAGENT_CHILD_ENV] === "1") return;
  const globalStore = globalThis;
  const runtimeCleanupStoreKey = "__piSubagentRuntimeCleanup";
  const previousRuntimeCleanup = globalStore[runtimeCleanupStoreKey];
  if (typeof previousRuntimeCleanup === "function") {
    try {
      previousRuntimeCleanup();
    } catch {

      // Best effort cleanup for stale timers from an older reload.
    }}

  ensureAccessibleDir(_types.RESULTS_DIR);
  ensureAccessibleDir(_types.ASYNC_DIR);
  (0, _settings.cleanupOldChainDirs)();

  const config = loadConfig();
  const asyncByDefault = config.asyncByDefault === true;
  const tempArtifactsDir = (0, _artifacts.getArtifactsDir)(null);
  (0, _artifacts.cleanupAllArtifactDirs)(_types.DEFAULT_ARTIFACT_CONFIG.cleanupDays);

  const state = {
    baseCwd: process.cwd(),
    currentSessionId: null,
    asyncJobs: new Map(),
    foregroundRuns: new Map(),
    foregroundControls: new Map(),
    lastForegroundControlId: null,
    pendingForegroundControlNotices: new Map(),
    cleanupTimers: new Map(),
    lastUiContext: null,
    poller: null,
    completionSeen: new Map(),
    watcher: null,
    watcherRestartTimer: null,
    resultFileCoalescer: {
      schedule: () => false,
      clear: () => {}
    }
  };

  const { startResultWatcher, primeExistingResults, stopResultWatcher } = (0, _resultWatcher.createResultWatcher)(
    pi,
    state,
    _types.RESULTS_DIR,
    10 * 60 * 1000
  );
  startResultWatcher();
  primeExistingResults();

  const runtimeCleanup = () => {
    (0, _render.stopWidgetAnimation)();
    (0, _render.stopResultAnimations)();
    stopResultWatcher();
    (0, _controlNotices.clearPendingForegroundControlNotices)(state);
    if (state.poller) {
      clearInterval(state.poller);
      state.poller = null;
    }
  };
  globalStore[runtimeCleanupStoreKey] = runtimeCleanup;

  const { ensurePoller, handleStarted, handleComplete, resetJobs } = (0, _asyncJobTracker.createAsyncJobTracker)(pi, state, _types.ASYNC_DIR);
  const executor = (0, _subagentExecutor.createSubagentExecutor)({
    pi,
    state,
    config,
    asyncByDefault,
    tempArtifactsDir,
    getSubagentSessionRoot,
    expandTilde,
    discoverAgents: _agents.discoverAgents
  });

  pi.registerMessageRenderer(_types.SLASH_RESULT_TYPE, (message, options, theme) => {
    const details = (0, _slashLiveState.resolveSlashMessageDetails)(message.details);
    if (!details) return undefined;
    return createSlashResultComponent(details, options, theme, () => state.lastUiContext?.ui.requestRender?.());
  });

  pi.registerMessageRenderer("subagent-notify", (message, options, theme) => {
    const content = typeof message.content === "string" ? message.content : "";
    const details = message.details ?? parseSubagentNotifyContent(content);
    if (!details) return new _piTui.Text(content, 0, 0);
    const icon = details.status === "completed" ?
    theme.fg("success", "✓") :
    details.status === "paused" ?
    theme.fg("warning", "■") :
    theme.fg("error", "✗");
    const parts = [];
    if (details.taskInfo) parts.push(details.taskInfo);
    if (details.durationMs !== undefined) parts.push((0, _formatters.formatDuration)(details.durationMs));
    let text = `${icon} ${theme.bold(details.agent)} ${theme.fg("dim", details.status)}`;
    if (parts.length > 0) text += ` ${theme.fg("dim", "·")} ${parts.map((part) => theme.fg("dim", part)).join(` ${theme.fg("dim", "·")} `)}`;
    const trimmedPreview = details.resultPreview.trim();
    const previewLines = options.expanded ?
    trimmedPreview.split("\n").filter((line) => line.trim()) :
    [trimmedPreview.split("\n", 1)[0] ?? ""].filter((line) => line.trim());
    for (const line of previewLines.length > 0 ? previewLines : ["(no output)"]) {
      text += `\n  ${theme.fg("dim", `⎿  ${line}`)}`;
    }
    if (!options.expanded && trimmedPreview.includes("\n")) {
      text += `\n  ${theme.fg("dim", "Ctrl+O full notification")}`;
    }
    if (details.sessionLabel && details.sessionValue) {
      text += `\n  ${theme.fg("muted", `${details.sessionLabel}: ${(0, _formatters.shortenPath)(details.sessionValue)}`)}`;
    }
    return new _piTui.Text(text, 0, 0);
  });

  pi.registerMessageRenderer(_controlNotices.SUBAGENT_CONTROL_MESSAGE_TYPE, (message, _options, theme) => {
    const details = message.details;
    if (!details?.event) return undefined;
    const content = typeof message.content === "string" ? message.content : undefined;
    return new SubagentControlNoticeComponent({ ...details, noticeText: (0, _controlNotices.formatSubagentControlNotice)(details, content) }, theme);
  });

  const executeSubagentCollapsed = (id, params, signal, onUpdate, ctx) => {
    if (ctx.hasUI) ctx.ui.setToolsExpanded(false);
    return executor.execute(id, params, signal, onUpdate, ctx);
  };

  const slashBridge = (0, _slashBridge.registerSlashSubagentBridge)({
    events: pi.events,
    getContext: () => state.lastUiContext,
    execute: (id, params, signal, onUpdate, ctx) =>
    executeSubagentCollapsed(id, params, signal, onUpdate, ctx)
  });

  const promptTemplateBridge = (0, _promptTemplateBridge.registerPromptTemplateDelegationBridge)({
    events: pi.events,
    getContext: () => state.lastUiContext,
    execute: async (requestId, request, signal, ctx, onUpdate) => {
      if (request.tasks && request.tasks.length > 0) {
        return executeSubagentCollapsed(
          requestId,
          {
            tasks: request.tasks,
            context: request.context,
            cwd: request.cwd,
            worktree: request.worktree,
            async: false,
            clarify: false
          },
          signal,
          onUpdate,
          ctx
        );
      }
      return executeSubagentCollapsed(
        requestId,
        {
          agent: request.agent,
          task: request.task,
          context: request.context,
          cwd: request.cwd,
          model: request.model,
          async: false,
          clarify: false
        },
        signal,
        onUpdate,
        ctx
      );
    }
  });

  function effectiveParallelTaskCount(tasks) {
    if (!tasks || tasks.length === 0) return 0;
    return tasks.reduce((total, task) => {
      const count = typeof task.count === "number" && Number.isInteger(task.count) && task.count >= 1 ? task.count : 1;
      return total + count;
    }, 0);
  }

  const tool = {
    name: "subagent",
    label: "Subagent",
    description: `Delegate to subagents or manage agent definitions.

EXECUTION (use exactly ONE mode):
• Before executing, use { action: "list" } to inspect configured agents/chains. Only execute agents listed as executable/non-disabled.
• SINGLE: { agent, task? } - one task; omit task for self-contained agents
• CHAIN: { chain: [{agent:"agent-a"}, {parallel:[{agent:"agent-b",count:3}]}] } - sequential pipeline with optional parallel fan-out
• PARALLEL: { tasks: [{agent,task,count?,output?,reads?,progress?}, ...], concurrency?: number, worktree?: true } - concurrent execution (worktree: isolate each task in a git worktree)
• Optional context: { context: "fresh" | "fork" } (default: if any requested agent has defaultContext: "fork", the whole invocation uses fork; otherwise "fresh"; inspect agent defaults via { action: "list" })

CHAIN TEMPLATE VARIABLES (use in task strings):
• {task} - The original task/request from the user
• {previous} - Text response from the previous step (empty for first step)
• {chain_dir} - Shared directory for chain files (e.g., <tmpdir>/pi-subagents-<scope>/chain-runs/abc123/)

Example: { chain: [{agent:"agent-a", task:"Analyze {task}"}, {agent:"agent-b", task:"Plan based on {previous}"}] }

MANAGEMENT (use action field, omit agent/task/chain/tasks):
• { action: "list" } - discover executable agents/chains
• { action: "get", agent: "name" } - full detail; packaged agents use dotted runtime names like "package.agent"
• { action: "create", config: { name: "custom-agent", package: "code-analysis", systemPrompt, systemPromptMode, inheritProjectContext, inheritSkills, defaultContext, ... } }
• { action: "update", agent: "code-analysis.custom-agent", config: { package: "analysis", ... } } - merge
• { action: "delete", agent: "code-analysis.custom-agent" }
• Use chainName for chain operations; packaged chains also use dotted runtime names

CONTROL:
• { action: "status", id: "..." } - inspect an async/background run by id or prefix
• { action: "interrupt", id?: "..." } - soft-interrupt the current child turn and leave the run paused
• { action: "resume", id: "...", message: "...", index?: 0 } - follow up with a live async child or revive a completed async/foreground child from its session

DIAGNOSTICS:
• { action: "doctor" } - read-only report for runtime paths, discovery, sessions, and intercom`,
    parameters: _schemas.SubagentParams,

    execute(id, params, signal, onUpdate, ctx) {
      return executeSubagentCollapsed(id, params, signal, onUpdate, ctx);
    },

    renderCall(args, theme) {
      if (args.action) {
        const target = args.agent || args.chainName || "";
        return new _piTui.Text(
          `${theme.fg("toolTitle", theme.bold("subagent "))}${args.action}${target ? ` ${theme.fg("accent", target)}` : ""}`,
          0, 0
        );
      }
      const isParallel = (args.tasks?.length ?? 0) > 0;
      const parallelCount = effectiveParallelTaskCount(args.tasks);
      const asyncLabel = args.async === true && !isParallel ? theme.fg("warning", " [async]") : "";
      if (args.chain?.length)
      return new _piTui.Text(
        `${theme.fg("toolTitle", theme.bold("subagent "))}chain (${args.chain.length})${asyncLabel}`,
        0,
        0
      );
      if (isParallel)
      return new _piTui.Text(
        `${theme.fg("toolTitle", theme.bold("subagent "))}parallel (${parallelCount})`,
        0,
        0
      );
      return new _piTui.Text(
        `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", args.agent || "?")}${asyncLabel}`,
        0,
        0
      );
    },

    renderResult(result, options, theme, context) {
      (0, _render.syncResultAnimation)(result, context);
      return (0, _render.renderSubagentResult)(result, options, theme);
    }

  };

  pi.registerTool(tool);
  (0, _slashCommands.registerSlashCommands)(pi, state);

  const eventUnsubscribeStoreKey = "__piSubagentEventUnsubscribes";
  const controlNoticeSeenStoreKey = "__piSubagentVisibleControlNotices";
  const previousEventUnsubscribes = globalStore[eventUnsubscribeStoreKey];
  if (Array.isArray(previousEventUnsubscribes)) {
    for (const unsubscribe of previousEventUnsubscribes) {
      if (typeof unsubscribe !== "function") continue;
      try {
        unsubscribe();
      } catch {

        // Best effort cleanup for stale handlers from an older reload.
      }}
  }
  (0, _notify.default)(pi);

  const existingVisibleControlNotices = globalStore[controlNoticeSeenStoreKey];
  const visibleControlNotices = existingVisibleControlNotices instanceof Set ? existingVisibleControlNotices : new Set();
  globalStore[controlNoticeSeenStoreKey] = visibleControlNotices;
  const controlEventHandler = (payload) => {
    (0, _controlNotices.handleSubagentControlNotice)({
      pi,
      state,
      visibleControlNotices,
      details: payload
    });
  };
  const eventUnsubscribes = [
  pi.events.on(_types.SUBAGENT_ASYNC_STARTED_EVENT, handleStarted),
  pi.events.on(_types.SUBAGENT_ASYNC_COMPLETE_EVENT, handleComplete),
  pi.events.on(_types.SUBAGENT_CONTROL_EVENT, controlEventHandler)];

  globalStore[eventUnsubscribeStoreKey] = eventUnsubscribes;

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "subagent") return;
    if (!ctx.hasUI) return;
    state.lastUiContext = ctx;
    if (state.asyncJobs.size > 0) {
      (0, _render.renderWidget)(ctx, Array.from(state.asyncJobs.values()));
      ensurePoller();
    }
  });

  const cleanupSessionArtifacts = (ctx) => {
    try {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) {
        (0, _artifacts.cleanupOldArtifacts)((0, _artifacts.getArtifactsDir)(sessionFile), _types.DEFAULT_ARTIFACT_CONFIG.cleanupDays);
      }
    } catch {

      // Cleanup failures should not block session lifecycle events.
    }};

  const resetSessionState = (ctx) => {
    state.baseCwd = ctx.cwd;
    state.currentSessionId = (0, _sessionIdentity.resolveCurrentSessionId)(ctx.sessionManager);
    state.lastUiContext = ctx;
    cleanupSessionArtifacts(ctx);
    (0, _controlNotices.clearPendingForegroundControlNotices)(state);
    resetJobs(ctx);
    (0, _slashLiveState.restoreSlashFinalSnapshots)(ctx.sessionManager.getEntries());
    primeExistingResults();
  };

  pi.on("session_start", (_event, ctx) => {
    resetSessionState(ctx);
  });

  pi.on("session_shutdown", () => {
    for (const unsubscribe of eventUnsubscribes) {
      try {
        unsubscribe();
      } catch {

        // Best effort cleanup during shutdown.
      }}
    if (globalStore[eventUnsubscribeStoreKey] === eventUnsubscribes) {
      delete globalStore[eventUnsubscribeStoreKey];
    }
    stopResultWatcher();
    if (state.poller) clearInterval(state.poller);
    state.poller = null;
    (0, _controlNotices.clearPendingForegroundControlNotices)(state);
    for (const timer of state.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    state.cleanupTimers.clear();
    state.asyncJobs.clear();
    (0, _slashLiveState.clearSlashSnapshots)();
    slashBridge.cancelAll();
    slashBridge.dispose();
    promptTemplateBridge.cancelAll();
    promptTemplateBridge.dispose();
    (0, _render.stopWidgetAnimation)();
    (0, _render.stopResultAnimations)();
    if (globalStore[runtimeCleanupStoreKey] === runtimeCleanup) {
      delete globalStore[runtimeCleanupStoreKey];
    }
    try {
      if (state.lastUiContext?.hasUI) {
        state.lastUiContext.ui.setWidget(_types.WIDGET_KEY, undefined);
      }
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error;
    }
  });
} /* v9-ae8021cc1ece3974 */
