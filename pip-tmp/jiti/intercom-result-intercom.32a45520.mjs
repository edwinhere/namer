"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.buildSubagentResultIntercomPayload = buildSubagentResultIntercomPayload;exports.deliverSubagentIntercomMessageEvent = deliverSubagentIntercomMessageEvent;exports.deliverSubagentResultIntercomEvent = deliverSubagentResultIntercomEvent;exports.formatSubagentResultReceipt = formatSubagentResultReceipt;exports.resolveSubagentResultStatus = resolveSubagentResultStatus;exports.stripDetailsOutputsForIntercomReceipt = stripDetailsOutputsForIntercomReceipt;var _nodeCrypto = await jitiImport("node:crypto");
var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var _types = await jitiImport("../shared/types.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}











function resolveSubagentResultStatus(input)





{
  if (input.detached) return "detached";
  if (input.interrupted || input.state === "paused") return "paused";
  if (typeof input.success === "boolean") return input.success ? "completed" : "failed";
  if (input.state === "complete") return "completed";
  if (input.state === "failed") return "failed";
  if (typeof input.exitCode === "number") return input.exitCode === 0 ? "completed" : "failed";
  return "failed";
}

function countStatuses(children) {
  const counts = {
    completed: 0,
    failed: 0,
    paused: 0,
    detached: 0
  };
  for (const child of children) {
    counts[child.status] += 1;
  }
  return counts;
}

function formatStatusCounts(counts) {
  const parts = [
  counts.completed ? `${counts.completed} completed` : undefined,
  counts.failed ? `${counts.failed} failed` : undefined,
  counts.paused ? `${counts.paused} paused` : undefined,
  counts.detached ? `${counts.detached} detached` : undefined].
  filter((part) => Boolean(part));
  return parts.length ? parts.join(", ") : "0 results";
}

function resolveGroupedStatus(children) {
  const counts = countStatuses(children);
  if (counts.failed > 0) return "failed";
  if (counts.paused > 0) return "paused";
  if (counts.completed > 0) return "completed";
  if (counts.detached > 0) return "detached";
  return "failed";
}












function asyncResumeGuidance(input)



{
  if (input.source !== "async" || !input.asyncId) return undefined;
  const resumable = input.children.filter((child) => typeof child.sessionPath === "string" && fs.existsSync(child.sessionPath));
  if (input.children.length === 1 && resumable.length === 1) {
    return `Revive: subagent({ action: "resume", id: "${input.asyncId}", message: "..." })`;
  }
  if (resumable.length > 0) {
    const firstIndex = resumable[0]?.index ?? input.children.indexOf(resumable[0]);
    return `Revive child: subagent({ action: "resume", id: "${input.asyncId}", index: ${firstIndex}, message: "..." })`;
  }
  return "Resume: unavailable; no child session file was persisted.";
}

function formatSubagentResultIntercomMessage(input)








{
  const counts = countStatuses(input.children);
  const lines = [
  "subagent results",
  "",
  `Run: ${input.runId}`,
  `Mode: ${input.mode}`,
  `Status: ${input.status}`,
  `Children: ${formatStatusCounts(counts)}`];

  if (input.mode === "chain" && typeof input.chainSteps === "number") {
    lines.push(`Chain steps: ${input.chainSteps}`);
  }
  if (input.asyncId) lines.push(`Async id: ${input.asyncId}`);
  if (input.asyncDir) lines.push(`Async dir: ${input.asyncDir}`);
  const resumeGuidance = asyncResumeGuidance(input);
  if (resumeGuidance) lines.push(resumeGuidance);
  if (input.children.some((child) => child.intercomTarget)) {
    lines.push("");
    lines.push(input.source === "async" ?
    "Previous intercom targets below identify child sessions used while they were running. Inspect artifacts or session logs if resume is unavailable." :
    "Intercom targets below identify child sessions used while they were running; completed child sessions may no longer be reachable. Inspect artifacts or session logs for follow-up.");
  }

  for (let index = 0; index < input.children.length; index++) {
    const child = input.children[index];
    lines.push("");
    lines.push(`${index + 1}. ${child.agent} — ${child.status}`);
    if (child.intercomTarget) lines.push(`${input.source === "async" ? "Previous intercom target" : "Run intercom target"}: ${child.intercomTarget}`);
    if (child.artifactPath) lines.push(`Output artifact: ${child.artifactPath}`);
    if (child.sessionPath) lines.push(`Session: ${child.sessionPath}`);
    lines.push("Summary:");
    lines.push(child.summary);
  }

  return lines.join("\n");
}

function buildSubagentResultIntercomPayload(input) {
  const children = input.children.map((child) => ({
    ...child,
    summary: child.summary.trim() || "(no output)"
  }));
  const status = resolveGroupedStatus(children);
  const summary = formatStatusCounts(countStatuses(children));
  const firstChild = children[0];
  const payload = {
    to: input.to,
    runId: input.runId,
    mode: input.mode,
    status,
    summary,
    source: input.source,
    children,
    ...(input.asyncId ? { asyncId: input.asyncId } : {}),
    ...(input.asyncDir ? { asyncDir: input.asyncDir } : {}),
    ...(typeof input.chainSteps === "number" ? { chainSteps: input.chainSteps } : {}),
    ...(firstChild?.agent ? { agent: firstChild.agent } : {}),
    ...(firstChild?.index !== undefined ? { index: firstChild.index } : {}),
    ...(firstChild?.artifactPath ? { artifactPath: firstChild.artifactPath } : {}),
    ...(firstChild?.sessionPath ? { sessionPath: firstChild.sessionPath } : {}),
    message: ""
  };
  payload.message = formatSubagentResultIntercomMessage(payload);
  return payload;
}

async function deliverSubagentResultIntercomEvent(
events,
payload,
timeoutMs = 500)
{
  return deliverSubagentIntercomMessageEvent(events, payload.to, payload.message, timeoutMs, payload);
}

async function deliverSubagentIntercomMessageEvent(
events,
to,
message,
timeoutMs = 500,
extra = {})
{
  if (typeof events.on !== "function" || typeof events.emit !== "function") return false;
  const requestId = typeof extra.requestId === "string" ? extra.requestId : (0, _nodeCrypto.randomUUID)();
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe;
    let timer;
    const finish = (delivered) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve(delivered);
    };
    unsubscribe = events.on(_types.SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT, (data) => {
      if (!data || typeof data !== "object") return;
      const delivery = data;
      if (delivery.requestId !== requestId) return;
      finish(delivery.delivered === true);
    });
    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      events.emit(_types.SUBAGENT_RESULT_INTERCOM_EVENT, { ...extra, to, message, requestId });
    } catch {
      finish(false);
    }
  });
}

function stripSingleResultOutputs(result) {
  return {
    ...result,
    messages: undefined,
    finalOutput: undefined,
    truncation: undefined
  };
}

function stripDetailsOutputsForIntercomReceipt(details) {
  return {
    ...details,
    results: details.results.map(stripSingleResultOutputs)
  };
}

function formatSubagentResultReceipt(input)



{
  const counts = countStatuses(input.payload.children);
  const modeLabel = input.mode === "single" ?
  "single subagent result" :
  input.mode === "parallel" ?
  "parallel subagent results" :
  "chain subagent results";
  const lines = [
  `Delivered ${modeLabel} via intercom.`,
  `Run: ${input.runId}`,
  `Children: ${formatStatusCounts(counts)}`];


  const artifacts = input.payload.children.filter((child) => typeof child.artifactPath === "string");
  if (artifacts.length > 0) {
    lines.push("Artifacts:");
    for (const child of artifacts) {
      lines.push(`- ${child.agent} [${child.status}]: ${child.artifactPath}`);
    }
  }

  const intercomTargets = input.payload.children.filter((child) => typeof child.intercomTarget === "string");
  if (intercomTargets.length > 0) {
    lines.push("Run intercom targets (may be inactive after completion):");
    for (const child of intercomTargets) {
      lines.push(`- ${child.agent} [${child.status}]: ${child.intercomTarget}`);
    }
  }

  const sessions = input.payload.children.filter((child) => typeof child.sessionPath === "string");
  if (sessions.length > 0) {
    lines.push("Sessions:");
    for (const child of sessions) {
      lines.push(`- ${child.agent} [${child.status}]: ${child.sessionPath}`);
    }
  }

  lines.push("Full grouped output was sent over intercom.");
  return lines.join("\n");
} /* v9-427c8e4be18cce04 */
