"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.default = registerSubagentNotify;




var _completionDedupe = await jitiImport("./completion-dedupe.ts");
var _types = await jitiImport("../../shared/types.ts"); /**
 * Subagent completion notifications.
 */

































function registerSubagentNotify(pi) {
  const unsubscribeStoreKey = "__pi_subagents_notify_unsubscribe__";
  const globalStore = globalThis;
  const previousUnsubscribe = globalStore[unsubscribeStoreKey];
  if (typeof previousUnsubscribe === "function") {
    try {
      previousUnsubscribe();
    } catch {

      // Best effort cleanup for stale handlers from an older reload.
    }}

  const seen = (0, _completionDedupe.getGlobalSeenMap)("__pi_subagents_notify_seen__");
  const ttlMs = 10 * 60 * 1000;

  const handleComplete = (data) => {
    const result = data;
    const now = Date.now();
    const key = (0, _completionDedupe.buildCompletionKey)(result, "notify");
    if ((0, _completionDedupe.markSeenWithTtl)(seen, key, now, ttlMs)) return;

    const agent = result.agent ?? "unknown";
    const summary = typeof result.summary === "string" ? result.summary : "";
    const paused = !result.success && (
    result.exitCode === 0 ||
    result.state === "paused" ||
    summary.startsWith("Paused after interrupt."));

    const status = paused ? "paused" : result.success ? "completed" : "failed";

    const taskInfo =
    result.taskIndex !== undefined && result.totalTasks !== undefined ?
    ` (${result.taskIndex + 1}/${result.totalTasks})` :
    "";

    const sessionLine = result.shareUrl ?
    `Session: ${result.shareUrl}` :
    result.shareError ?
    `Session share error: ${result.shareError}` :
    result.sessionFile ?
    `Session file: ${result.sessionFile}` :
    undefined;

    const displaySummary = summary.trim() ? summary : "(no output)";
    const content = [
    `Background task ${status}: **${agent}**${taskInfo}`,
    "",
    displaySummary,
    sessionLine ? "" : undefined,
    sessionLine].

    filter((line) => line !== undefined).
    join("\n");

    pi.sendMessage(
      {
        customType: "subagent-notify",
        content,
        display: true
      },
      { triggerTurn: true }
    );
  };

  globalStore[unsubscribeStoreKey] = pi.events.on(_types.SUBAGENT_ASYNC_COMPLETE_EVENT, handleComplete);
} /* v9-d92e3a54b93efe80 */
