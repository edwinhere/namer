"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.INTERCOM_BRIDGE_MARKER = void 0;exports.applyIntercomBridgeToAgent = applyIntercomBridgeToAgent;exports.diagnoseIntercomBridge = diagnoseIntercomBridge;exports.resolveIntercomBridge = resolveIntercomBridge;exports.resolveIntercomBridgeMode = resolveIntercomBridgeMode;exports.resolveIntercomSessionTarget = resolveIntercomSessionTarget;exports.resolveSubagentIntercomTarget = resolveSubagentIntercomTarget;var _nodeChild_process = await jitiImport("node:child_process");
var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var os = _interopRequireWildcard(await jitiImport("node:os"));
var path = _interopRequireWildcard(await jitiImport("node:path"));function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}



const PI_INTERCOM_PACKAGE_NAME = "pi-intercom";
const CONFIG_DIR = ".pi";

function defaultAgentDir() {
  return path.join(os.homedir(), ".pi", "agent");
}

function defaultIntercomExtensionDir(agentDir = defaultAgentDir()) {
  return path.join(agentDir, "extensions", PI_INTERCOM_PACKAGE_NAME);
}

function defaultIntercomConfigPath(agentDir = defaultAgentDir()) {
  return path.join(agentDir, "intercom", "config.json");
}

function defaultSubagentConfigDir(agentDir = defaultAgentDir()) {
  return path.join(agentDir, "extensions", "subagent");
}

const DEFAULT_INTERCOM_TARGET_PREFIX = "subagent-chat";
const INTERCOM_BRIDGE_MARKER = exports.INTERCOM_BRIDGE_MARKER = "Intercom orchestration channel:";
const DEFAULT_INTERCOM_BRIDGE_TEMPLATE = `The inherited thread is reference-only. Do not continue that conversation or send questions, status updates, or completion handoffs to the supervisor in normal assistant text.

Use contact_supervisor first. It resolves the supervisor session "{orchestratorTarget}" and run metadata automatically.
- Need a decision, blocked, approval, or product/API/scope ambiguity: contact_supervisor({ reason: "need_decision", message: "<question>" })
- After contact_supervisor with reason "need_decision", stay alive and continue only after the reply arrives. Do not finish your final response with a choose-one question.
- Do not ask for clarification when the only conflict is review-only/no-edit versus progress-writing or artifact-writing instructions. Review-only/no-edit wins; leave files unchanged and mention the conflict in your final result only if it matters.
- Meaningful progress or unexpected discoveries that change the plan: contact_supervisor({ reason: "progress_update", message: "UPDATE: <summary>" })
- Generic intercom is lower-level plumbing/fallback only: intercom({ action: "ask", to: "{orchestratorTarget}", message: "<question>" })

Do not use contact_supervisor or intercom for routine completion handoffs. If no coordination is needed, return a focused task result.`;


































function resolveIntercomSessionTarget(sessionName, sessionId) {
  const trimmedName = sessionName?.trim();
  if (trimmedName) return trimmedName;
  const normalizedSessionId = sessionId.startsWith("session-") ? sessionId.slice("session-".length) : sessionId;
  return `${DEFAULT_INTERCOM_TARGET_PREFIX}-${normalizedSessionId.slice(0, 8)}`;
}

function sanitizeIntercomTargetPart(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

function resolveSubagentIntercomTarget(runId, agent, index) {
  const stepSuffix = index !== undefined ? `-${index + 1}` : "";
  return `subagent-${sanitizeIntercomTargetPart(agent)}-${sanitizeIntercomTargetPart(runId)}${stepSuffix}`;
}

function resolveIntercomBridgeMode(value) {
  if (value === "off" || value === "always" || value === "fork-only") return value;
  return "always";
}

function resolveIntercomBridgeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      mode: "always",
      instructionFile: ""
    };
  }
  return {
    mode: resolveIntercomBridgeMode(value.mode),
    instructionFile: typeof value.instructionFile === "string" ? value.instructionFile : ""
  };
}

function intercomConfigStatus(configPath) {
  if (!fs.existsSync(configPath)) return { enabled: true };
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return { enabled: parsed.enabled !== false };
  } catch (error) {
    return { enabled: true, error };
  }
}

function readJsonBestEffort(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") console.warn(`Failed to read JSON from '${filePath}'.`, error);
    return null;
  }
}

function packageHasPiExtension(packageRoot) {
  if (!fs.existsSync(packageRoot)) return false;
  const pkg = readJsonBestEffort(path.join(packageRoot, "package.json"));
  if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
    const pi = pkg.pi;
    if (pi && typeof pi === "object" && !Array.isArray(pi)) {
      const extensions = pi.extensions;
      return Array.isArray(extensions) && extensions.some((entry) => typeof entry === "string" && entry.trim() !== "");
    }
  }
  return fs.existsSync(path.join(packageRoot, "extensions"));
}

function isSafePackagePath(value) {
  return value.length > 0 &&
  !path.isAbsolute(value) &&
  value.split(/[\\/]/).every((part) => part.length > 0 && part !== "." && part !== "..");
}

function parseNpmPackageName(source) {
  const spec = source.slice(4).trim();
  if (!spec) return undefined;
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  const packageName = match?.[1] ?? spec;
  return isSafePackagePath(packageName) ? packageName : undefined;
}

function packageEntrySource(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.source === "string") {
    return entry.source;
  }
  return undefined;
}

function packageEntryAllowsExtensions(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
  const extensions = entry.extensions;
  return !Array.isArray(extensions) || extensions.length > 0;
}

function findNearestProjectConfigDir(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    const configDir = path.join(current, CONFIG_DIR);
    if (fs.existsSync(path.join(configDir, "settings.json"))) return configDir;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

let cachedGlobalNpmRoot;

function getGlobalNpmRoot() {
  if (cachedGlobalNpmRoot !== undefined) return cachedGlobalNpmRoot;
  try {
    cachedGlobalNpmRoot = (0, _nodeChild_process.execSync)("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim();
    return cachedGlobalNpmRoot;
  } catch {
    cachedGlobalNpmRoot = null;
    return null;
  }
}

function configuredPiIntercomPackageDir(input, agentDir) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const projectConfigDir = findNearestProjectConfigDir(cwd);
  const settingsFiles = [
  ...(projectConfigDir ? [{ file: path.join(projectConfigDir, "settings.json"), configDir: projectConfigDir, scope: "project" }] : []),
  { file: path.join(agentDir, "settings.json"), configDir: agentDir, scope: "user" }];

  const globalNpmRoot = input.globalNpmRoot === undefined ? getGlobalNpmRoot() : input.globalNpmRoot;

  for (const { file, configDir, scope } of settingsFiles) {
    const settings = readJsonBestEffort(file);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) continue;
    const packages = settings.packages;
    if (!Array.isArray(packages)) continue;

    for (const entry of packages) {
      if (!packageEntryAllowsExtensions(entry)) continue;
      const source = packageEntrySource(entry)?.trim();
      if (!source?.startsWith("npm:")) continue;
      const packageName = parseNpmPackageName(source);
      if (packageName !== PI_INTERCOM_PACKAGE_NAME) continue;
      const candidates = scope === "project" ?
      [path.join(configDir, "npm", "node_modules", packageName)] :
      [
      ...(globalNpmRoot ? [path.join(globalNpmRoot, packageName)] : []),
      path.join(agentDir, "npm", "node_modules", packageName)];

      const packageRoot = candidates.find(packageHasPiExtension);
      if (packageRoot) return path.resolve(packageRoot);
    }
  }
  return undefined;
}

function resolveIntercomExtensionDir(input, agentDir) {
  const legacyDir = path.resolve(input.extensionDir ?? defaultIntercomExtensionDir(agentDir));
  if (fs.existsSync(legacyDir)) return legacyDir;
  return configuredPiIntercomPackageDir(input, agentDir) ?? legacyDir;
}

function extensionSandboxAllowsIntercom(extensions, extensionDir) {
  if (extensions === undefined) return true;

  const intercomDir = path.resolve(extensionDir).replaceAll("\\", "/").toLowerCase();
  for (const entry of extensions) {
    const normalized = entry.trim().replaceAll("\\", "/").toLowerCase();
    if (normalized === "pi-intercom") return true;
    if (normalized === intercomDir) return true;
    if (normalized.startsWith(`${intercomDir}/`)) return true;
    if (normalized.endsWith("/pi-intercom")) return true;
    if (normalized.includes("/pi-intercom/")) return true;
  }
  return false;
}

function expandTilde(filePath) {
  return filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
}

function resolveInstructionTemplate(instructionFile, settingsDir) {
  if (!instructionFile) return DEFAULT_INTERCOM_BRIDGE_TEMPLATE;
  const expandedPath = expandTilde(instructionFile);
  const resolvedPath = path.isAbsolute(expandedPath) ?
  expandedPath :
  path.resolve(settingsDir, expandedPath);
  try {
    return fs.readFileSync(resolvedPath, "utf-8");
  } catch (error) {
    console.warn(`Failed to read intercom bridge instructionFile at '${resolvedPath}'. Using default instructions.`, error);
    return DEFAULT_INTERCOM_BRIDGE_TEMPLATE;
  }
}

function buildIntercomBridgeInstruction(orchestratorTarget, template) {
  const instruction = template.replaceAll("{orchestratorTarget}", orchestratorTarget).trim();
  if (instruction.startsWith(INTERCOM_BRIDGE_MARKER)) return instruction;
  return `${INTERCOM_BRIDGE_MARKER}
${instruction}`;
}

function diagnoseIntercomBridge(input) {
  const config = resolveIntercomBridgeConfig(input.config);
  const mode = config.mode;
  const agentDir = path.resolve(input.agentDir ?? defaultAgentDir());
  const extensionDir = resolveIntercomExtensionDir(input, agentDir);
  const orchestratorTarget = input.orchestratorTarget?.trim();
  const configPath = path.resolve(input.configPath ?? defaultIntercomConfigPath(agentDir));
  const wantsIntercom = mode !== "off" && !(mode === "fork-only" && input.context !== "fork");
  const piIntercomAvailable = fs.existsSync(extensionDir);
  let configStatus;
  let reason;
  if (mode === "off") reason = "bridge mode is off";else
  if (mode === "fork-only" && input.context !== "fork") reason = "bridge mode is fork-only and context is not fork";else
  if (!orchestratorTarget) reason = "orchestrator target is not available";else
  if (!piIntercomAvailable) reason = "pi-intercom extension was not found";else
  {
    configStatus = intercomConfigStatus(configPath);
    if (!configStatus.enabled) reason = "intercom config is disabled";
  }
  let intercomConfigError;
  if (configStatus?.error) {
    const error = configStatus.error;
    intercomConfigError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  return {
    active: reason === undefined,
    mode,
    wantsIntercom,
    piIntercomAvailable,
    extensionDir,
    configPath,
    ...(orchestratorTarget ? { orchestratorTarget } : {}),
    ...(reason ? { reason } : {}),
    ...(configStatus ? { intercomConfigEnabled: configStatus.enabled } : {}),
    ...(intercomConfigError ? { intercomConfigError } : {})
  };
}

function resolveIntercomBridge(input) {
  const config = resolveIntercomBridgeConfig(input.config);
  const mode = config.mode;
  const agentDir = path.resolve(input.agentDir ?? defaultAgentDir());
  const extensionDir = resolveIntercomExtensionDir(input, agentDir);
  const orchestratorTarget = input.orchestratorTarget?.trim();
  const settingsDir = path.resolve(input.settingsDir ?? defaultSubagentConfigDir(agentDir));
  const defaultInstruction = buildIntercomBridgeInstruction(
    orchestratorTarget || "{orchestratorTarget}",
    DEFAULT_INTERCOM_BRIDGE_TEMPLATE
  );

  if (mode === "off") {
    return { active: false, mode, extensionDir, instruction: defaultInstruction };
  }
  if (mode === "fork-only" && input.context !== "fork") {
    return { active: false, mode, extensionDir, instruction: defaultInstruction };
  }
  if (!orchestratorTarget) {
    return { active: false, mode, extensionDir, instruction: defaultInstruction };
  }
  if (!fs.existsSync(extensionDir)) {
    return { active: false, mode, extensionDir, instruction: defaultInstruction };
  }

  const configPath = path.resolve(input.configPath ?? defaultIntercomConfigPath(agentDir));
  const intercomStatus = intercomConfigStatus(configPath);
  if (intercomStatus.error) console.warn(`Failed to parse intercom config at '${configPath}'. Assuming enabled.`, intercomStatus.error);
  if (!intercomStatus.enabled) {
    return { active: false, mode, extensionDir, instruction: defaultInstruction };
  }

  const instruction = buildIntercomBridgeInstruction(
    orchestratorTarget,
    resolveInstructionTemplate(config.instructionFile, settingsDir)
  );

  return {
    active: true,
    mode,
    orchestratorTarget,
    extensionDir,
    instruction
  };
}

function applyIntercomBridgeToAgent(agent, bridge) {
  if (!bridge.active || !bridge.orchestratorTarget) return agent;
  if (!extensionSandboxAllowsIntercom(agent.extensions, bridge.extensionDir)) return agent;

  const bridgeTools = ["intercom", "contact_supervisor"];
  const tools = agent.tools ?
  [...agent.tools, ...bridgeTools.filter((tool) => !agent.tools?.includes(tool))] :
  agent.tools;
  const instruction = bridge.instruction;
  const trimmedPrompt = agent.systemPrompt?.trim() || "";
  const systemPrompt = trimmedPrompt.includes(INTERCOM_BRIDGE_MARKER) ?
  trimmedPrompt :
  trimmedPrompt ?
  `${trimmedPrompt}\n\n${instruction}` :
  instruction;

  if (tools === agent.tools && systemPrompt === agent.systemPrompt) return agent;
  return {
    ...agent,
    tools,
    systemPrompt
  };
} /* v9-8debbb1836ab02f2 */
