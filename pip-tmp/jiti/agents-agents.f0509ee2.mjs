"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.buildBuiltinOverrideConfig = buildBuiltinOverrideConfig;Object.defineProperty(exports, "buildRuntimeName", { enumerable: true, get: function () {return _identity.buildRuntimeName;} });exports.defaultInheritProjectContext = defaultInheritProjectContext;exports.defaultInheritSkills = defaultInheritSkills;exports.defaultSystemPromptMode = defaultSystemPromptMode;exports.discoverAgents = discoverAgents;exports.discoverAgentsAll = discoverAgentsAll;Object.defineProperty(exports, "frontmatterNameForConfig", { enumerable: true, get: function () {return _identity.frontmatterNameForConfig;} });Object.defineProperty(exports, "parsePackageName", { enumerable: true, get: function () {return _identity.parsePackageName;} });exports.removeBuiltinAgentOverride = removeBuiltinAgentOverride;exports.saveBuiltinAgentOverride = saveBuiltinAgentOverride;



var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var os = _interopRequireWildcard(await jitiImport("node:os"));
var path = _interopRequireWildcard(await jitiImport("node:path"));
var _nodeUrl = await jitiImport("node:url");

var _agentSerializer = await jitiImport("./agent-serializer.ts");
var _chainSerializer = await jitiImport("./chain-serializer.ts");
var _agentSelection = await jitiImport("./agent-selection.ts");
var _frontmatter = await jitiImport("./frontmatter.ts");
var _identity = await jitiImport("./identity.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);} /**
 * Agent discovery and configuration
 */






function defaultSystemPromptMode(name) {
  return name === "delegate" ? "append" : "replace";
}

function defaultInheritProjectContext(name) {
  return name === "delegate";
}

function defaultInheritSkills() {
  return false;
}






































































const EMPTY_SUBAGENT_SETTINGS = { overrides: {} };




























function getUserChainDir() {
  return path.join(os.homedir(), ".pi", "agent", "chains");
}

function splitToolList(rawTools) {
  const mcpDirectTools = [];
  const tools = [];
  for (const tool of rawTools ?? []) {
    if (tool.startsWith("mcp:")) {
      mcpDirectTools.push(tool.slice(4));
    } else {
      tools.push(tool);
    }
  }
  return {
    ...(tools.length > 0 ? { tools } : {}),
    ...(mcpDirectTools.length > 0 ? { mcpDirectTools } : {})
  };
}

function joinToolList(config) {
  const joined = [
  ...(config.tools ?? []),
  ...(config.mcpDirectTools ?? []).map((tool) => `mcp:${tool}`)];

  return joined.length > 0 ? joined : undefined;
}

function arraysEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function cloneOverrideBase(agent) {
  return {
    model: agent.model,
    fallbackModels: agent.fallbackModels ? [...agent.fallbackModels] : undefined,
    thinking: agent.thinking,
    systemPromptMode: agent.systemPromptMode,
    inheritProjectContext: agent.inheritProjectContext,
    inheritSkills: agent.inheritSkills,
    defaultContext: agent.defaultContext,
    disabled: agent.disabled,
    systemPrompt: agent.systemPrompt,
    skills: agent.skills ? [...agent.skills] : undefined,
    tools: agent.tools ? [...agent.tools] : undefined,
    mcpDirectTools: agent.mcpDirectTools ? [...agent.mcpDirectTools] : undefined
  };
}

function cloneOverrideValue(override) {
  return {
    ...(override.model !== undefined ? { model: override.model } : {}),
    ...(override.fallbackModels !== undefined ?
    { fallbackModels: override.fallbackModels === false ? false : [...override.fallbackModels] } :
    {}),
    ...(override.thinking !== undefined ? { thinking: override.thinking } : {}),
    ...(override.systemPromptMode !== undefined ? { systemPromptMode: override.systemPromptMode } : {}),
    ...(override.inheritProjectContext !== undefined ? { inheritProjectContext: override.inheritProjectContext } : {}),
    ...(override.inheritSkills !== undefined ? { inheritSkills: override.inheritSkills } : {}),
    ...(override.defaultContext !== undefined ? { defaultContext: override.defaultContext } : {}),
    ...(override.disabled !== undefined ? { disabled: override.disabled } : {}),
    ...(override.systemPrompt !== undefined ? { systemPrompt: override.systemPrompt } : {}),
    ...(override.skills !== undefined ? { skills: override.skills === false ? false : [...override.skills] } : {}),
    ...(override.tools !== undefined ? { tools: override.tools === false ? false : [...override.tools] } : {})
  };
}

function findNearestProjectRoot(cwd) {
  let currentDir = cwd;
  while (true) {
    if (isDirectory(path.join(currentDir, ".pi")) || isDirectory(path.join(currentDir, ".agents"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function getUserAgentSettingsPath() {
  return path.join(os.homedir(), ".pi", "agent", "settings.json");
}

function getProjectAgentSettingsPath(cwd) {
  const projectRoot = findNearestProjectRoot(cwd);
  return projectRoot ? path.join(projectRoot, ".pi", "settings.json") : null;
}

function readSettingsFileStrict(filePath) {
  if (!fs.existsSync(filePath)) return {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read settings file '${filePath}': ${message}`, { cause: error });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse settings file '${filePath}': ${message}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Settings file '${filePath}' must contain a JSON object.`);
  }
  return parsed;
}

function writeSettingsFile(filePath, settings) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

function parseOverrideStringArrayOrFalse(
value,
meta)
{
  if (value === undefined) return undefined;
  if (value === false) return false;
  if (!Array.isArray(value)) {
    throw new Error(`Builtin override '${meta.name}' in '${meta.filePath}' has invalid '${meta.field}'; expected an array of strings or false.`);
  }

  const items = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`Builtin override '${meta.name}' in '${meta.filePath}' has invalid '${meta.field}'; expected an array of strings or false.`);
    }
    const trimmed = item.trim();
    if (trimmed) items.push(trimmed);
  }
  return items;
}

function parseBuiltinOverrideEntry(
name,
value,
filePath)
{
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Builtin override '${name}' in '${filePath}' must be an object.`);
  }

  const input = value;
  const override = {};

  if ("model" in input) {
    if (typeof input.model === "string" || input.model === false) override.model = input.model;else
    throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'model'; expected a string or false.`);
  }

  if ("thinking" in input) {
    if (typeof input.thinking === "string" || input.thinking === false) override.thinking = input.thinking;else
    throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'thinking'; expected a string or false.`);
  }

  if ("systemPromptMode" in input) {
    if (input.systemPromptMode === "append" || input.systemPromptMode === "replace") {
      override.systemPromptMode = input.systemPromptMode;
    } else {
      throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'systemPromptMode'; expected 'append' or 'replace'.`);
    }
  }

  if ("inheritProjectContext" in input) {
    if (typeof input.inheritProjectContext === "boolean") {
      override.inheritProjectContext = input.inheritProjectContext;
    } else {
      throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'inheritProjectContext'; expected a boolean.`);
    }
  }

  if ("inheritSkills" in input) {
    if (typeof input.inheritSkills === "boolean") {
      override.inheritSkills = input.inheritSkills;
    } else {
      throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'inheritSkills'; expected a boolean.`);
    }
  }

  if ("defaultContext" in input) {
    if (input.defaultContext === "fresh" || input.defaultContext === "fork" || input.defaultContext === false) {
      override.defaultContext = input.defaultContext;
    } else {
      throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'defaultContext'; expected 'fresh', 'fork', or false.`);
    }
  }

  if ("disabled" in input) {
    if (typeof input.disabled === "boolean") {
      override.disabled = input.disabled;
    } else {
      throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'disabled'; expected a boolean.`);
    }
  }

  if ("systemPrompt" in input) {
    if (typeof input.systemPrompt === "string") override.systemPrompt = input.systemPrompt;else
    throw new Error(`Builtin override '${name}' in '${filePath}' has invalid 'systemPrompt'; expected a string.`);
  }

  const fallbackModels = parseOverrideStringArrayOrFalse(input.fallbackModels, { filePath, name, field: "fallbackModels" });
  if (fallbackModels !== undefined) override.fallbackModels = fallbackModels;

  const skills = parseOverrideStringArrayOrFalse(input.skills, { filePath, name, field: "skills" });
  if (skills !== undefined) override.skills = skills;

  const tools = parseOverrideStringArrayOrFalse(input.tools, { filePath, name, field: "tools" });
  if (tools !== undefined) override.tools = tools;

  return Object.keys(override).length > 0 ? override : undefined;
}

function readSubagentSettings(filePath) {
  if (!filePath) return EMPTY_SUBAGENT_SETTINGS;
  const settings = readSettingsFileStrict(filePath);
  const subagents = settings.subagents;
  if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return EMPTY_SUBAGENT_SETTINGS;

  const subagentsObject = subagents;
  let disableBuiltins;
  if ("disableBuiltins" in subagentsObject) {
    if (typeof subagentsObject.disableBuiltins === "boolean") {
      disableBuiltins = subagentsObject.disableBuiltins;
    } else {
      throw new Error(`Subagent settings in '${filePath}' have invalid 'disableBuiltins'; expected a boolean.`);
    }
  }

  const parsed = {};
  const agentOverrides = subagentsObject.agentOverrides;
  if (!agentOverrides || typeof agentOverrides !== "object" || Array.isArray(agentOverrides)) {
    return { overrides: parsed, disableBuiltins };
  }
  for (const [name, value] of Object.entries(agentOverrides)) {
    const override = parseBuiltinOverrideEntry(name, value, filePath);
    if (override) parsed[name] = override;
  }
  return { overrides: parsed, disableBuiltins };
}

function applyBuiltinOverride(
agent,
override,
meta)
{
  const next = {
    ...agent,
    override: { ...meta, base: cloneOverrideBase(agent) }
  };

  if (override.model !== undefined) next.model = override.model === false ? undefined : override.model;
  if (override.fallbackModels !== undefined) {
    next.fallbackModels = override.fallbackModels === false ? undefined : [...override.fallbackModels];
  }
  if (override.thinking !== undefined) next.thinking = override.thinking === false ? undefined : override.thinking;
  if (override.systemPromptMode !== undefined) next.systemPromptMode = override.systemPromptMode;
  if (override.inheritProjectContext !== undefined) next.inheritProjectContext = override.inheritProjectContext;
  if (override.inheritSkills !== undefined) next.inheritSkills = override.inheritSkills;
  if (override.defaultContext !== undefined) next.defaultContext = override.defaultContext === false ? undefined : override.defaultContext;
  if (override.disabled !== undefined) next.disabled = override.disabled;
  if (override.systemPrompt !== undefined) next.systemPrompt = override.systemPrompt;
  if (override.skills !== undefined) next.skills = override.skills === false ? undefined : [...override.skills];
  if (override.tools !== undefined) {
    const { tools, mcpDirectTools } = splitToolList(override.tools === false ? [] : override.tools);
    next.tools = tools;
    next.mcpDirectTools = mcpDirectTools;
  }

  return next;
}

function applyBuiltinOverrides(
builtinAgents,
userSettings,
projectSettings,
userSettingsPath,
projectSettingsPath)
{
  const projectBulkDisabled = projectSettings.disableBuiltins === true && projectSettingsPath !== null;
  const userBulkDisabled = projectSettings.disableBuiltins === undefined && userSettings.disableBuiltins === true;

  return builtinAgents.map((agent) => {
    const projectOverride = projectSettings.overrides[agent.name];
    if (projectOverride && projectSettingsPath) {
      return applyBuiltinOverride(agent, projectOverride, { scope: "project", path: projectSettingsPath });
    }

    if (projectBulkDisabled && projectSettingsPath) {
      return applyBuiltinOverride(agent, { disabled: true }, { scope: "project", path: projectSettingsPath });
    }

    const userOverride = userSettings.overrides[agent.name];
    if (userOverride) {
      return applyBuiltinOverride(agent, userOverride, { scope: "user", path: userSettingsPath });
    }

    if (userBulkDisabled) {
      return applyBuiltinOverride(agent, { disabled: true }, { scope: "user", path: userSettingsPath });
    }

    return agent;
  });
}

function buildBuiltinOverrideConfig(
base,
draft)
{
  const override = {};

  if (draft.model !== base.model) override.model = draft.model ?? false;
  if (!arraysEqual(draft.fallbackModels, base.fallbackModels)) override.fallbackModels = draft.fallbackModels ? [...draft.fallbackModels] : false;
  if (draft.thinking !== base.thinking) override.thinking = draft.thinking ?? false;
  if (draft.systemPromptMode !== base.systemPromptMode) override.systemPromptMode = draft.systemPromptMode;
  if (draft.inheritProjectContext !== base.inheritProjectContext) override.inheritProjectContext = draft.inheritProjectContext;
  if (draft.inheritSkills !== base.inheritSkills) override.inheritSkills = draft.inheritSkills;
  if (draft.defaultContext !== base.defaultContext) override.defaultContext = draft.defaultContext ?? false;
  if (draft.disabled !== base.disabled) override.disabled = draft.disabled ?? false;
  if (draft.systemPrompt !== base.systemPrompt) override.systemPrompt = draft.systemPrompt;
  if (!arraysEqual(draft.skills, base.skills)) override.skills = draft.skills ? [...draft.skills] : false;

  const baseTools = joinToolList(base);
  const draftTools = joinToolList(draft);
  if (!arraysEqual(draftTools, baseTools)) override.tools = draftTools ? [...draftTools] : false;

  return Object.keys(override).length > 0 ? override : undefined;
}

function saveBuiltinAgentOverride(
cwd,
name,
scope,
override)
{
  const filePath = scope === "project" ? getProjectAgentSettingsPath(cwd) : getUserAgentSettingsPath();
  if (!filePath) throw new Error("Project override is not available here. No project config root was found.");

  const settings = readSettingsFileStrict(filePath);
  const subagents = settings.subagents && typeof settings.subagents === "object" && !Array.isArray(settings.subagents) ?
  { ...settings.subagents } :
  {};
  const agentOverrides = subagents.agentOverrides && typeof subagents.agentOverrides === "object" && !Array.isArray(subagents.agentOverrides) ?
  { ...subagents.agentOverrides } :
  {};

  agentOverrides[name] = cloneOverrideValue(override);
  subagents.agentOverrides = agentOverrides;
  settings.subagents = subagents;
  writeSettingsFile(filePath, settings);
  return filePath;
}

function removeBuiltinAgentOverride(cwd, name, scope) {
  const filePath = scope === "project" ? getProjectAgentSettingsPath(cwd) : getUserAgentSettingsPath();
  if (!filePath) throw new Error("Project override is not available here. No project config root was found.");
  if (!fs.existsSync(filePath)) return filePath;

  const settings = readSettingsFileStrict(filePath);
  const subagents = settings.subagents;
  if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return filePath;
  const nextSubagents = { ...subagents };
  const agentOverrides = nextSubagents.agentOverrides;
  if (!agentOverrides || typeof agentOverrides !== "object" || Array.isArray(agentOverrides)) return filePath;

  const nextOverrides = { ...agentOverrides };
  delete nextOverrides[name];
  if (Object.keys(nextOverrides).length > 0) nextSubagents.agentOverrides = nextOverrides;else
  delete nextSubagents.agentOverrides;

  if (Object.keys(nextSubagents).length > 0) settings.subagents = nextSubagents;else
  delete settings.subagents;

  writeSettingsFile(filePath, settings);
  return filePath;
}

function listMarkdownFilesRecursive(dir, predicate) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return files;
  }

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFilesRecursive(filePath, predicate));
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!predicate(entry.name)) continue;
    files.push(filePath);
  }
  return files;
}

function loadAgentsFromDir(dir, source) {
  const agents = [];

  for (const filePath of listMarkdownFilesRecursive(dir, (fileName) => fileName.endsWith(".md") && !fileName.endsWith(".chain.md"))) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = (0, _frontmatter.parseFrontmatter)(content);

    if (!frontmatter.name || !frontmatter.description) {
      continue;
    }

    const localName = frontmatter.name;
    const parsedPackage = (0, _identity.parsePackageName)(frontmatter.package, `Agent '${localName}' package`);
    if (parsedPackage.error) continue;
    const packageName = parsedPackage.packageName;
    const runtimeName = (0, _identity.buildRuntimeName)(localName, packageName);

    const rawTools = frontmatter.tools?.
    split(",").
    map((t) => t.trim()).
    filter(Boolean);

    const mcpDirectTools = [];
    const tools = [];
    if (rawTools) {
      for (const tool of rawTools) {
        if (tool.startsWith("mcp:")) {
          mcpDirectTools.push(tool.slice(4));
        } else {
          tools.push(tool);
        }
      }
    }

    const defaultReads = frontmatter.defaultReads?.
    split(",").
    map((f) => f.trim()).
    filter(Boolean);

    const skillStr = frontmatter.skill || frontmatter.skills;
    const skills = skillStr?.
    split(",").
    map((s) => s.trim()).
    filter(Boolean);
    const fallbackModels = frontmatter.fallbackModels?.
    split(",").
    map((model) => model.trim()).
    filter(Boolean);
    const systemPromptMode = frontmatter.systemPromptMode === "replace" ?
    "replace" :
    frontmatter.systemPromptMode === "append" ?
    "append" :
    defaultSystemPromptMode(localName);
    const inheritProjectContext = frontmatter.inheritProjectContext === "true" ?
    true :
    frontmatter.inheritProjectContext === "false" ?
    false :
    defaultInheritProjectContext(localName);
    const inheritSkills = frontmatter.inheritSkills === "true" ?
    true :
    frontmatter.inheritSkills === "false" ?
    false :
    defaultInheritSkills();
    const defaultContext = frontmatter.defaultContext === "fork" ?
    "fork" :
    frontmatter.defaultContext === "fresh" ?
    "fresh" :
    undefined;

    let extensions;
    if (frontmatter.extensions !== undefined) {
      extensions = frontmatter.extensions.
      split(",").
      map((e) => e.trim()).
      filter(Boolean);
    }

    const extraFields = {};
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!_agentSerializer.KNOWN_FIELDS.has(key)) extraFields[key] = value;
    }

    const parsedMaxSubagentDepth = Number(frontmatter.maxSubagentDepth);

    agents.push({
      name: runtimeName,
      localName,
      packageName,
      description: frontmatter.description,
      tools: tools.length > 0 ? tools : undefined,
      mcpDirectTools: mcpDirectTools.length > 0 ? mcpDirectTools : undefined,
      model: frontmatter.model,
      fallbackModels: fallbackModels && fallbackModels.length > 0 ? fallbackModels : undefined,
      thinking: frontmatter.thinking,
      systemPromptMode,
      inheritProjectContext,
      inheritSkills,
      defaultContext,
      systemPrompt: body,
      source,
      filePath,
      skills: skills && skills.length > 0 ? skills : undefined,
      extensions,
      output: frontmatter.output,
      defaultReads: defaultReads && defaultReads.length > 0 ? defaultReads : undefined,
      defaultProgress: frontmatter.defaultProgress === "true",
      interactive: frontmatter.interactive === "true",
      maxSubagentDepth:
      Number.isInteger(parsedMaxSubagentDepth) && parsedMaxSubagentDepth >= 0 ?
      parsedMaxSubagentDepth :
      undefined,
      extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined
    });
  }

  return agents;
}

function loadChainsFromDir(dir, source) {
  const chains = [];

  for (const filePath of listMarkdownFilesRecursive(dir, (fileName) => fileName.endsWith(".chain.md"))) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    try {
      chains.push((0, _chainSerializer.parseChain)(content, source, filePath));
    } catch {
      continue;
    }
  }

  return chains;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveNearestProjectAgentDirs(cwd) {
  const projectRoot = findNearestProjectRoot(cwd);
  if (!projectRoot) return { readDirs: [], preferredDir: null };

  const legacyDir = path.join(projectRoot, ".agents");
  const preferredDir = path.join(projectRoot, ".pi", "agents");
  const readDirs = [];
  if (isDirectory(legacyDir)) readDirs.push(legacyDir);
  if (isDirectory(preferredDir)) readDirs.push(preferredDir);

  return {
    readDirs,
    preferredDir
  };
}

function resolveNearestProjectChainDirs(cwd) {
  const projectRoot = findNearestProjectRoot(cwd);
  if (!projectRoot) return { readDirs: [], preferredDir: null };

  const preferredDir = path.join(projectRoot, ".pi", "chains");
  return {
    readDirs: isDirectory(preferredDir) ? [preferredDir] : [],
    preferredDir
  };
}
const BUILTIN_AGENTS_DIR = path.resolve(path.dirname((0, _nodeUrl.fileURLToPath)("file:///home/edwin/.config/nvm/versions/node/v22.20.0/lib/node_modules/pi-subagents/src/agents/agents.ts")), "..", "..", "agents");

function discoverAgents(cwd, scope) {
  const userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");
  const userDirNew = path.join(os.homedir(), ".agents");
  const { readDirs: projectAgentDirs, preferredDir: projectAgentsDir } = resolveNearestProjectAgentDirs(cwd);
  const userSettingsPath = getUserAgentSettingsPath();
  const projectSettingsPath = getProjectAgentSettingsPath(cwd);
  const userSettings = scope === "project" ? EMPTY_SUBAGENT_SETTINGS : readSubagentSettings(userSettingsPath);
  const projectSettings = scope === "user" ? EMPTY_SUBAGENT_SETTINGS : readSubagentSettings(projectSettingsPath);

  const builtinAgents = applyBuiltinOverrides(
    loadAgentsFromDir(BUILTIN_AGENTS_DIR, "builtin"),
    userSettings,
    projectSettings,
    userSettingsPath,
    projectSettingsPath
  );

  const userAgentsOld = scope === "project" ? [] : loadAgentsFromDir(userDirOld, "user");
  const userAgentsNew = scope === "project" ? [] : loadAgentsFromDir(userDirNew, "user");
  const userAgents = [...userAgentsOld, ...userAgentsNew];

  const projectAgents = scope === "user" ? [] : projectAgentDirs.flatMap((dir) => loadAgentsFromDir(dir, "project"));
  const agents = (0, _agentSelection.mergeAgentsForScope)(scope, userAgents, projectAgents, builtinAgents).
  filter((agent) => agent.disabled !== true);

  return { agents, projectAgentsDir };
}

function discoverAgentsAll(cwd)










{
  const userDirOld = path.join(os.homedir(), ".pi", "agent", "agents");
  const userDirNew = path.join(os.homedir(), ".agents");
  const userChainDir = getUserChainDir();
  const { readDirs: projectDirs, preferredDir: projectDir } = resolveNearestProjectAgentDirs(cwd);
  const { readDirs: projectChainDirs, preferredDir: projectChainDir } = resolveNearestProjectChainDirs(cwd);
  const userSettingsPath = getUserAgentSettingsPath();
  const projectSettingsPath = getProjectAgentSettingsPath(cwd);
  const userSettings = readSubagentSettings(userSettingsPath);
  const projectSettings = readSubagentSettings(projectSettingsPath);

  const builtin = applyBuiltinOverrides(
    loadAgentsFromDir(BUILTIN_AGENTS_DIR, "builtin"),
    userSettings,
    projectSettings,
    userSettingsPath,
    projectSettingsPath
  );
  const user = [
  ...loadAgentsFromDir(userDirOld, "user"),
  ...loadAgentsFromDir(userDirNew, "user")];

  const projectMap = new Map();
  for (const dir of projectDirs) {
    for (const agent of loadAgentsFromDir(dir, "project")) {
      projectMap.set(agent.name, agent);
    }
  }
  const project = Array.from(projectMap.values());

  const chainMap = new Map();
  for (const dir of projectChainDirs) {
    for (const chain of loadChainsFromDir(dir, "project")) {
      chainMap.set(chain.name, chain);
    }
  }
  const chains = [
  ...loadChainsFromDir(userChainDir, "user"),
  ...Array.from(chainMap.values())];


  const userDir = fs.existsSync(userDirNew) ? userDirNew : userDirOld;

  return { builtin, user, project, chains, userDir, projectDir, userChainDir, projectChainDir, userSettingsPath, projectSettingsPath };
} /* v9-467e5e633d01fc28 */
