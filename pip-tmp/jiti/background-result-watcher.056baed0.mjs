"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.createResultWatcher = createResultWatcher;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));
var _completionDedupe = await jitiImport("./completion-dedupe.ts");
var _fileCoalescer = await jitiImport("../../shared/file-coalescer.ts");
var _types = await jitiImport("../../shared/types.ts");




var _resultIntercom = await jitiImport("../../intercom/result-intercom.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}





const WATCHER_RESTART_DELAY_MS = 3000;
const POLL_INTERVAL_MS = 3000;















function getErrorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ?
  error.code :
  undefined;
}

function isNotFoundError(error) {
  return getErrorCode(error) === "ENOENT";
}

function shouldFallBackToPolling(error) {
  const code = getErrorCode(error);
  return code === "EMFILE" || code === "ENOSPC";
}

function createResultWatcher(
pi,
state,
resultsDir,
completionTtlMs,
deps = {})




{
  const fsApi = deps.fs ?? fs;
  const timers = deps.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };

  const handleResult = async (file) => {
    const resultPath = path.join(resultsDir, file);
    if (!fsApi.existsSync(resultPath)) return;
    try {
      const data = JSON.parse(fsApi.readFileSync(resultPath, "utf-8"));






















      if (data.sessionId && data.sessionId !== state.currentSessionId) return;
      if (!data.sessionId && data.cwd && data.cwd !== state.baseCwd) return;

      const now = Date.now();
      const completionKey = (0, _completionDedupe.buildCompletionKey)(data, `result:${file}`);
      if ((0, _completionDedupe.markSeenWithTtl)(state.completionSeen, completionKey, now, completionTtlMs)) {
        fsApi.unlinkSync(resultPath);
        return;
      }

      const intercomTarget = data.intercomTarget?.trim();
      if (intercomTarget) {
        const childResults = Array.isArray(data.results) && data.results.length > 0 ?
        data.results :
        [{
          agent: data.agent,
          output: data.summary,
          success: data.success
        }];
        const runId = data.runId ?? data.id ?? file.replace(/\.json$/i, "");
        const mode = data.mode === "single" || data.mode === "parallel" || data.mode === "chain" ?
        data.mode :
        childResults.length > 1 ? "chain" : "single";
        const payload = (0, _resultIntercom.buildSubagentResultIntercomPayload)({
          to: intercomTarget,
          runId,
          mode,
          source: "async",
          children: childResults.map((result = {}, index) => {
            const baseOutput = result.output ?? data.summary;
            const hasRealOutput = typeof baseOutput === "string" && baseOutput.trim().length > 0;
            const output = hasRealOutput ? baseOutput : "(no output)";
            const summary = result.success === false && result.error ?
            `${result.error}${hasRealOutput ? `\n\nOutput:\n${baseOutput}` : ""}` :
            output;
            const sessionPath = result.sessionFile ?? (childResults.length === 1 ? data.sessionFile : undefined);
            return {
              agent: result.agent ?? data.agent ?? `step-${index + 1}`,
              status: (0, _resultIntercom.resolveSubagentResultStatus)({
                success: result.success,
                state: data.state === "paused" || typeof result.success !== "boolean" ? data.state : undefined
              }),
              summary,
              index,
              artifactPath: result.artifactPaths?.outputPath,
              ...(typeof sessionPath === "string" && fsApi.existsSync(sessionPath) ? { sessionPath } : {}),
              intercomTarget: result.intercomTarget
            };
          }),
          asyncId: data.id,
          asyncDir: data.asyncDir
        });
        const delivered = await (0, _resultIntercom.deliverSubagentResultIntercomEvent)(pi.events, payload);
        if (!delivered) {
          console.error(`Subagent async grouped result intercom delivery was not acknowledged for '${resultPath}'.`);
        }
      }

      pi.events.emit(_types.SUBAGENT_ASYNC_COMPLETE_EVENT, data);
      fsApi.unlinkSync(resultPath);
    } catch (error) {
      if (isNotFoundError(error)) return;
      console.error(`Failed to process subagent result file '${resultPath}':`, error);
    }
  };

  state.resultFileCoalescer = (0, _fileCoalescer.createFileCoalescer)((file) => {
    void handleResult(file);
  }, 50);

  const primeExistingResults = () => {
    try {
      fsApi.readdirSync(resultsDir).
      filter((f) => f.endsWith(".json")).
      forEach((file) => state.resultFileCoalescer.schedule(file, 0));
    } catch (error) {
      if (isNotFoundError(error)) return;
      console.error(`Failed to scan subagent result directory '${resultsDir}':`, error);
    }
  };

  const startPollingFallback = (reason) => {
    state.watcher?.close();
    state.watcher = null;
    if (state.watcherRestartTimer) return;

    console.error(
      `Subagent result watcher for '${resultsDir}' fell back to polling because native fs.watch is unavailable (${getErrorCode(reason) ?? "unknown error"}).`
    );
    primeExistingResults();
    state.watcherRestartTimer = timers.setInterval(primeExistingResults, POLL_INTERVAL_MS);
    state.watcherRestartTimer.unref?.();
  };

  const scheduleRestart = () => {
    if (state.watcherRestartTimer) return;
    state.watcherRestartTimer = timers.setTimeout(() => {
      state.watcherRestartTimer = null;
      try {
        fsApi.mkdirSync(resultsDir, { recursive: true });
        startResultWatcher();
      } catch (error) {
        if (shouldFallBackToPolling(error)) {
          startPollingFallback(error);
          return;
        }
        console.error(`Failed to restart subagent result watcher for '${resultsDir}':`, error);
        scheduleRestart();
      }
    }, WATCHER_RESTART_DELAY_MS);
    state.watcherRestartTimer.unref?.();
  };

  const startResultWatcher = () => {
    if (state.watcher) return;
    if (state.watcherRestartTimer) {
      timers.clearTimeout(state.watcherRestartTimer);
      timers.clearInterval(state.watcherRestartTimer);
      state.watcherRestartTimer = null;
    }
    try {
      state.watcher = fsApi.watch(resultsDir, (ev, file) => {
        if (ev !== "rename" || !file) return;
        const fileName = file.toString();
        if (!fileName.endsWith(".json")) return;
        state.resultFileCoalescer.schedule(fileName);
      });
      state.watcher.on("error", (error) => {
        if (shouldFallBackToPolling(error)) {
          startPollingFallback(error);
          return;
        }
        console.error(`Subagent result watcher failed for '${resultsDir}':`, error);
        state.watcher?.close();
        state.watcher = null;
        scheduleRestart();
      });
      state.watcher.unref?.();
    } catch (error) {
      if (shouldFallBackToPolling(error)) {
        startPollingFallback(error);
        return;
      }
      console.error(`Failed to start subagent result watcher for '${resultsDir}':`, error);
      state.watcher = null;
      scheduleRestart();
    }
  };

  const stopResultWatcher = () => {
    state.watcher?.close();
    state.watcher = null;
    if (state.watcherRestartTimer) {
      timers.clearTimeout(state.watcherRestartTimer);
      timers.clearInterval(state.watcherRestartTimer);
    }
    state.watcherRestartTimer = null;
    state.resultFileCoalescer.clear();
  };

  return { startResultWatcher, primeExistingResults, stopResultWatcher };
} /* v9-43f45ffab2803705 */
