"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.buildDoctorReport = buildDoctorReport;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));
var _agents = await jitiImport("../agents/agents.ts");
var _asyncExecution = await jitiImport("../runs/background/async-execution.ts");
var _intercomBridge = await jitiImport("../intercom/intercom-bridge.ts");
var _skills = await jitiImport("../agents/skills.ts");
var _types = await jitiImport("../shared/types.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}





































const DEFAULT_PATHS = {
  tempRootDir: _types.TEMP_ROOT_DIR,
  asyncDir: _types.ASYNC_DIR,
  resultsDir: _types.RESULTS_DIR,
  chainRunsDir: _types.CHAIN_RUNS_DIR
};

const DEFAULT_DEPS = {
  isAsyncAvailable: _asyncExecution.isAsyncAvailable,
  discoverAgentsAll: _agents.discoverAgentsAll,
  discoverAvailableSkills: _skills.discoverAvailableSkills,
  diagnoseIntercomBridge: _intercomBridge.diagnoseIntercomBridge
};

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function lineFromCheck(label, check) {
  try {
    return check();
  } catch (error) {
    return `- ${label}: failed — ${errorText(error)}`;
  }
}

function formatExistingDirectory(label, dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return `- ${label}: missing (${dirPath})`;
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) throw new Error(`not a directory: ${dirPath}`);
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
    return `- ${label}: ok (${dirPath})`;
  } catch (error) {
    return `- ${label}: failed (${dirPath}) — ${errorText(error)}`;
  }
}

function formatSourceCounts(counts) {
  return `builtin ${counts.builtin}, user ${counts.user}, project ${counts.project}`;
}

function formatSkillSourceCounts(skills) {
  const counts = new Map();
  for (const skill of skills) counts.set(skill.source, (counts.get(skill.source) ?? 0) + 1);
  const ordered = [
  "project",
  "project-settings",
  "project-package",
  "user",
  "user-settings",
  "user-package",
  "extension",
  "builtin",
  "unknown"];

  const parts = ordered.
  map((source) => `${source} ${counts.get(source) ?? 0}`).
  filter((part) => !part.endsWith(" 0"));
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatConfiguredSessionDir(input) {
  if (input.requestedSessionDir) {
    return path.resolve(input.expandTilde?.(input.requestedSessionDir) ?? input.requestedSessionDir);
  }
  if (input.config.defaultSessionDir) {
    return path.resolve(input.expandTilde?.(input.config.defaultSessionDir) ?? input.config.defaultSessionDir);
  }
  return "not configured";
}

function formatSessionLines(input) {
  const sessionFile = input.currentSessionFile ?? null;
  const lines = [
  lineFromCheck("configured session dir", () => `- configured session dir: ${formatConfiguredSessionDir(input)}`),
  `- current session file: ${sessionFile ?? "not available"}`,
  `- current session dir: ${sessionFile ? path.dirname(sessionFile) : "not available"}`,
  `- current session id: ${input.currentSessionId ?? input.state.currentSessionId ?? "not available"}`];

  if (input.sessionError) lines.push(`- session manager: failed — ${input.sessionError}`);
  return lines;
}

function formatDiscovery(input, deps) {
  return [
  lineFromCheck("agents/chains", () => {
    const discovered = deps.discoverAgentsAll(input.cwd);
    const agentCounts = {
      builtin: discovered.builtin.length,
      user: discovered.user.length,
      project: discovered.project.length
    };
    const chainCounts = discovered.chains.reduce((counts, chain) => {
      counts[chain.source] += 1;
      return counts;
    }, { builtin: 0, user: 0, project: 0 });
    return [
    `- agents: total ${agentCounts.builtin + agentCounts.user + agentCounts.project} (${formatSourceCounts(agentCounts)})`,
    `- chains: total ${discovered.chains.length} (${formatSourceCounts(chainCounts)})`].
    join("\n");
  }),
  lineFromCheck("skills", () => {
    const skills = deps.discoverAvailableSkills(input.cwd);
    return `- skills: total ${skills.length} (${formatSkillSourceCounts(skills)})`;
  })];

}

function formatIntercomDiagnostic(diagnostic, context) {
  const lines = [
  `- bridge: ${diagnostic.active ? "active" : "inactive"}${diagnostic.reason ? ` (${diagnostic.reason})` : ""}`,
  `- mode: ${diagnostic.mode}; context: ${context ?? "unspecified"}`,
  `- orchestrator target: ${diagnostic.orchestratorTarget ?? "not available"}`,
  `- pi-intercom: ${diagnostic.piIntercomAvailable ? "available" : "unavailable"} at ${diagnostic.extensionDir}`];

  if (diagnostic.configPath && diagnostic.intercomConfigEnabled !== undefined) {
    lines.push(`- intercom config: ${diagnostic.intercomConfigEnabled === false ? "disabled" : "enabled or absent"} (${diagnostic.configPath})`);
  }
  if (diagnostic.intercomConfigError) {
    lines.push(`- intercom config warning: ${diagnostic.intercomConfigError}; runtime assumes enabled`);
  }
  return lines;
}

function buildDoctorReport(input) {
  const paths = input.paths ?? DEFAULT_PATHS;
  const deps = { ...DEFAULT_DEPS, ...input.deps };
  const lines = [
  "Subagents doctor report",
  "",
  "Runtime",
  `- cwd: ${input.cwd}`,
  lineFromCheck("async support", () => `- async support: ${deps.isAsyncAvailable() ? "available" : "unavailable"}`),
  ...formatSessionLines(input),
  "",
  "Filesystem",
  formatExistingDirectory("temp root", paths.tempRootDir),
  formatExistingDirectory("async runs", paths.asyncDir),
  formatExistingDirectory("results", paths.resultsDir),
  formatExistingDirectory("chain runs", paths.chainRunsDir),
  "",
  "Discovery",
  ...formatDiscovery(input, deps),
  "",
  "Intercom bridge",
  ...lineFromCheck("intercom bridge", () => formatIntercomDiagnostic(deps.diagnoseIntercomBridge({
    config: input.config.intercomBridge,
    context: input.context,
    orchestratorTarget: input.orchestratorTarget,
    cwd: input.cwd
  }), input.context).join("\n")).split("\n")];

  return lines.join("\n");
} /* v9-0e2e3df69035f087 */
