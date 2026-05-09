"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.handleCreate = handleCreate;exports.handleList = handleList;exports.handleManagementAction = handleManagementAction;exports.handleUpdate = handleUpdate;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var path = _interopRequireWildcard(await jitiImport("node:path"));


var _agents = await jitiImport("./agents.ts");













var _agentSerializer = await jitiImport("./agent-serializer.ts");
var _chainSerializer = await jitiImport("./chain-serializer.ts");
var _skills = await jitiImport("./skills.ts");function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}














function result(text, isError = false) {
  return { content: [{ type: "text", text }], isError, details: { mode: "management", results: [] } };
}

function parseCsv(value) {
  return [...new Set(value.split(",").map((v) => v.trim()).filter(Boolean))];
}

function configObject(config) {
  let val = config;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `config must be valid JSON: ${message}` };
    }
  }
  if (!val || typeof val !== "object" || Array.isArray(val)) return {};
  return { value: val };
}

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function asDisambiguationScope(scope) {
  if (scope === "user" || scope === "project") return scope;
  return undefined;
}

function normalizeListScope(scope) {
  if (scope === undefined) return "both";
  if (scope === "user" || scope === "project" || scope === "both") return scope;
  return undefined;
}

function sanitizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function parsePackageConfig(value) {
  return (0, _agents.parsePackageName)(value, "config.package");
}

function allAgents(d) {
  return [...d.builtin, ...d.user, ...d.project];
}

function availableNames(cwd, kind) {
  const d = (0, _agents.discoverAgentsAll)(cwd);
  const items = kind === "agent" ? allAgents(d) : d.chains;
  return [...new Set(items.map((x) => x.name))].sort((a, b) => a.localeCompare(b));
}

function findAgents(name, cwd, scope = "both") {
  const d = (0, _agents.discoverAgentsAll)(cwd);
  const raw = name.trim();
  const sanitized = sanitizeName(raw);
  return allAgents(d).
  filter((a) => (scope === "both" || a.source === scope) && (a.name === raw || a.name === sanitized)).
  sort((a, b) => a.source.localeCompare(b.source));
}

function findChains(name, cwd, scope = "both") {
  const raw = name.trim();
  const sanitized = sanitizeName(raw);
  return (0, _agents.discoverAgentsAll)(cwd).chains.
  filter((c) => (scope === "both" || c.source === scope) && (c.name === raw || c.name === sanitized)).
  sort((a, b) => a.source.localeCompare(b.source));
}

function nameExistsInScope(cwd, scope, name, excludePath) {
  const d = (0, _agents.discoverAgentsAll)(cwd);
  for (const a of scope === "user" ? d.user : d.project) {
    if (a.name === name && a.filePath !== excludePath) return true;
  }
  for (const c of d.chains) {
    if (c.source === scope && c.name === name && c.filePath !== excludePath) return true;
  }
  return false;
}

function unknownChainAgents(cwd, steps) {
  const d = (0, _agents.discoverAgentsAll)(cwd);
  const known = new Set(allAgents(d).map((a) => a.name));
  return [...new Set(steps.map((s) => s.agent).filter((a) => !known.has(a)))].sort((a, b) => a.localeCompare(b));
}

function chainStepWarnings(ctx, steps) {
  const warnings = [];
  const available = new Set((0, _skills.discoverAvailableSkills)(ctx.cwd).map((s) => s.name));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.model) {
      const found = ctx.modelRegistry.getAvailable().some((m) => `${m.provider}/${m.id}` === s.model || m.id === s.model);
      if (!found) warnings.push(`Warning: step ${i + 1} (${s.agent}): model '${s.model}' is not in the current model registry.`);
    }
    if (Array.isArray(s.skills) && s.skills.length > 0) {
      const missing = s.skills.filter((sk) => !available.has(sk));
      if (missing.length) warnings.push(`Warning: step ${i + 1} (${s.agent}): skills not found: ${missing.join(", ")}.`);
    }
  }
  return warnings;
}

function modelWarning(ctx, model) {
  if (!model) return undefined;
  const found = ctx.modelRegistry.getAvailable().some((m) => `${m.provider}/${m.id}` === model || m.id === model);
  return found ? undefined : `Warning: model '${model}' is not in the current model registry.`;
}

function fallbackModelsWarning(ctx, fallbackModels) {
  if (!fallbackModels || fallbackModels.length === 0) return undefined;
  const available = new Set(ctx.modelRegistry.getAvailable().flatMap((m) => [`${m.provider}/${m.id}`, m.id]));
  const missing = fallbackModels.filter((model) => !available.has(model));
  return missing.length ? `Warning: fallback models not in the current model registry: ${missing.join(", ")}.` : undefined;
}

function skillsWarning(cwd, skills) {
  if (!skills || skills.length === 0) return undefined;
  const available = new Set((0, _skills.discoverAvailableSkills)(cwd).map((s) => s.name));
  const missing = skills.filter((s) => !available.has(s));
  return missing.length ? `Warning: skills not found: ${missing.join(", ")}.` : undefined;
}

function parseStepList(raw) {
  if (!Array.isArray(raw)) return { error: "config.steps must be an array." };
  if (raw.length === 0) return { error: "config.steps must include at least one step." };
  const steps = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `config.steps[${i}] must be an object.` };
    const s = item;
    if (typeof s.agent !== "string" || !s.agent.trim()) return { error: `config.steps[${i}].agent must be a non-empty string.` };
    const step = { agent: s.agent.trim(), task: typeof s.task === "string" ? s.task : "" };
    if (hasKey(s, "output")) {
      if (s.output === false) step.output = false;else
      if (typeof s.output === "string") step.output = s.output;else
      return { error: `config.steps[${i}].output must be a string or false.` };
    }
    if (hasKey(s, "outputMode")) {
      if (s.outputMode === "inline" || s.outputMode === "file-only") step.outputMode = s.outputMode;else
      return { error: `config.steps[${i}].outputMode must be 'inline' or 'file-only'.` };
    }
    if (hasKey(s, "reads")) {
      if (s.reads === false) step.reads = false;else
      if (Array.isArray(s.reads)) step.reads = s.reads.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean);else
      return { error: `config.steps[${i}].reads must be an array or false.` };
    }
    if (hasKey(s, "model")) {
      if (typeof s.model === "string") step.model = s.model;else
      return { error: `config.steps[${i}].model must be a string.` };
    }
    if (hasKey(s, "skills")) {
      if (s.skills === false) step.skills = false;else
      if (Array.isArray(s.skills)) step.skills = s.skills.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean);else
      return { error: `config.steps[${i}].skills must be an array or false.` };
    }
    if (hasKey(s, "progress")) {
      if (typeof s.progress === "boolean") step.progress = s.progress;else
      return { error: `config.steps[${i}].progress must be a boolean.` };
    }
    steps.push(step);
  }
  return { steps };
}

function parseTools(raw) {
  const tools = [];
  const mcpDirectTools = [];
  for (const item of parseCsv(raw)) {
    if (item.startsWith("mcp:")) {
      const direct = item.slice(4).trim();
      if (direct) mcpDirectTools.push(direct);
    } else tools.push(item);
  }
  return { tools: tools.length ? tools : undefined, mcpDirectTools: mcpDirectTools.length ? mcpDirectTools : undefined };
}

function applyAgentConfig(target, cfg) {
  if (hasKey(cfg, "systemPrompt")) {
    if (cfg.systemPrompt === false || cfg.systemPrompt === "") target.systemPrompt = "";else
    if (typeof cfg.systemPrompt === "string") target.systemPrompt = cfg.systemPrompt;else
    return "config.systemPrompt must be a string or false when provided.";
  }
  if (hasKey(cfg, "model")) {
    if (cfg.model === false || cfg.model === "") target.model = undefined;else
    if (typeof cfg.model === "string") target.model = cfg.model.trim() || undefined;else
    return "config.model must be a string or false when provided.";
  }
  if (hasKey(cfg, "fallbackModels")) {
    if (cfg.fallbackModels === false || cfg.fallbackModels === "") target.fallbackModels = undefined;else
    if (typeof cfg.fallbackModels === "string") {
      const models = parseCsv(cfg.fallbackModels);
      target.fallbackModels = models.length ? models : undefined;
    } else if (Array.isArray(cfg.fallbackModels)) {
      const models = cfg.fallbackModels.
      filter((value) => typeof value === "string").
      map((value) => value.trim()).
      filter(Boolean);
      target.fallbackModels = models.length ? [...new Set(models)] : undefined;
    } else return "config.fallbackModels must be a comma-separated string, string array, or false when provided.";
  }
  if (hasKey(cfg, "tools")) {
    if (cfg.tools === false || cfg.tools === "") {target.tools = undefined;target.mcpDirectTools = undefined;} else
    if (typeof cfg.tools === "string") {const parsed = parseTools(cfg.tools);target.tools = parsed.tools;target.mcpDirectTools = parsed.mcpDirectTools;} else
    return "config.tools must be a comma-separated string or false when provided.";
  }
  if (hasKey(cfg, "skills")) {
    if (cfg.skills === false || cfg.skills === "") target.skills = undefined;else
    if (typeof cfg.skills === "string") {const skills = parseCsv(cfg.skills);target.skills = skills.length ? skills : undefined;} else
    return "config.skills must be a comma-separated string or false when provided.";
  }
  if (hasKey(cfg, "extensions")) {
    if (cfg.extensions === false) target.extensions = undefined;else
    if (cfg.extensions === "") target.extensions = [];else
    if (typeof cfg.extensions === "string") target.extensions = parseCsv(cfg.extensions);else
    return "config.extensions must be a comma-separated string, empty string, or false when provided.";
  }
  if (hasKey(cfg, "thinking")) {
    if (cfg.thinking === false || cfg.thinking === "") target.thinking = undefined;else
    if (typeof cfg.thinking === "string") target.thinking = cfg.thinking.trim() || undefined;else
    return "config.thinking must be a string or false when provided.";
  }
  if (hasKey(cfg, "systemPromptMode")) {
    if (cfg.systemPromptMode === "append" || cfg.systemPromptMode === "replace") target.systemPromptMode = cfg.systemPromptMode;else
    return "config.systemPromptMode must be 'append' or 'replace' when provided.";
  }
  if (hasKey(cfg, "inheritProjectContext")) {
    if (typeof cfg.inheritProjectContext !== "boolean") return "config.inheritProjectContext must be a boolean when provided.";
    target.inheritProjectContext = cfg.inheritProjectContext;
  }
  if (hasKey(cfg, "inheritSkills")) {
    if (typeof cfg.inheritSkills !== "boolean") return "config.inheritSkills must be a boolean when provided.";
    target.inheritSkills = cfg.inheritSkills;
  }
  if (hasKey(cfg, "defaultContext")) {
    if (cfg.defaultContext === false || cfg.defaultContext === "") target.defaultContext = undefined;else
    if (cfg.defaultContext === "fresh" || cfg.defaultContext === "fork") target.defaultContext = cfg.defaultContext;else
    return "config.defaultContext must be 'fresh', 'fork', or false when provided.";
  }
  if (hasKey(cfg, "output")) {
    if (cfg.output === false || cfg.output === "") target.output = undefined;else
    if (typeof cfg.output === "string") target.output = cfg.output;else
    return "config.output must be a string or false when provided.";
  }
  if (hasKey(cfg, "reads")) {
    if (cfg.reads === false || cfg.reads === "") target.defaultReads = undefined;else
    if (typeof cfg.reads === "string") {
      const reads = parseCsv(cfg.reads);
      target.defaultReads = reads.length ? reads : undefined;
    } else return "config.reads must be a comma-separated string or false when provided.";
  }
  if (hasKey(cfg, "progress")) {
    if (typeof cfg.progress !== "boolean") return "config.progress must be a boolean when provided.";
    target.defaultProgress = cfg.progress;
  }
  if (hasKey(cfg, "maxSubagentDepth")) {
    if (cfg.maxSubagentDepth === false || cfg.maxSubagentDepth === "") target.maxSubagentDepth = undefined;else
    if (typeof cfg.maxSubagentDepth === "number" && Number.isInteger(cfg.maxSubagentDepth) && cfg.maxSubagentDepth >= 0) {
      target.maxSubagentDepth = cfg.maxSubagentDepth;
    } else return "config.maxSubagentDepth must be an integer >= 0 or false when provided.";
  }
  return undefined;
}

function resolveTarget(
kind,
name,
matches,
cwd,
scopeHint)
{
  const mutable = matches.filter((m) => m.source !== "builtin");
  if (mutable.length === 0) {
    if (matches.length > 0) {
      return result(`${kind === "agent" ? "Agent" : "Chain"} '${name}' is builtin and cannot be modified. Create a same-named ${kind} in user or project scope to override it.`, true);
    }
    const available = availableNames(cwd, kind);
    return result(`${kind === "agent" ? "Agent" : "Chain"} '${name}' not found. Available: ${available.join(", ") || "none"}.`, true);
  }
  if (mutable.length === 1) return mutable[0];
  const scope = asDisambiguationScope(scopeHint);
  if (!scope) {
    const paths = mutable.map((m) => `${m.source}: ${m.filePath}`).join("\n");
    return result(`${kind === "agent" ? "Agent" : "Chain"} '${name}' exists in both scopes. Specify agentScope: 'user' or 'project'.\n${paths}`, true);
  }
  const scoped = mutable.filter((m) => m.source === scope);
  if (scoped.length === 0) return result(`${kind === "agent" ? "Agent" : "Chain"} '${name}' not found in scope '${scope}'.`, true);
  if (scoped.length > 1) return result(`Multiple ${kind}s named '${name}' found in scope '${scope}': ${scoped.map((m) => m.filePath).join(", ")}`, true);
  return scoped[0];
}

function renamePath(
kind,
currentPath,
newName,
scope,
cwd)
{
  if (nameExistsInScope(cwd, scope, newName, currentPath)) return { error: `Name '${newName}' already exists in ${scope} scope.` };
  const ext = kind === "agent" ? ".md" : ".chain.md";
  const filePath = path.join(path.dirname(currentPath), `${newName}${ext}`);
  if (fs.existsSync(filePath) && filePath !== currentPath) {
    return { error: `File already exists at ${filePath} but is not a valid ${kind} definition. Remove or rename it first.` };
  }
  fs.renameSync(currentPath, filePath);
  return { filePath };
}

function formatAgentDetail(agent) {
  const tools = [...(agent.tools ?? []), ...(agent.mcpDirectTools ?? []).map((t) => `mcp:${t}`)];
  const lines = [`Agent: ${agent.name} (${agent.source})`, `Path: ${agent.filePath}`, `Description: ${agent.description}`];
  if (agent.packageName) {
    lines.push(`Local name: ${(0, _agents.frontmatterNameForConfig)(agent)}`);
    lines.push(`Package: ${agent.packageName}`);
  }
  if (agent.model) lines.push(`Model: ${agent.model}`);
  if (agent.fallbackModels?.length) lines.push(`Fallback models: ${agent.fallbackModels.join(", ")}`);
  if (tools.length) lines.push(`Tools: ${tools.join(", ")}`);
  if (agent.skills?.length) lines.push(`Skills: ${agent.skills.join(", ")}`);
  lines.push(`System prompt mode: ${agent.systemPromptMode}`);
  lines.push(`Inherit project context: ${agent.inheritProjectContext ? "true" : "false"}`);
  lines.push(`Inherit skills: ${agent.inheritSkills ? "true" : "false"}`);
  if (agent.defaultContext) lines.push(`Default context: ${agent.defaultContext}`);
  if (agent.source === "builtin") lines.push(`Disabled: ${agent.disabled ? "true" : "false"}`);
  if (agent.extensions !== undefined) lines.push(`Extensions: ${agent.extensions.length ? agent.extensions.join(", ") : "(none)"}`);
  if (agent.thinking) lines.push(`Thinking: ${agent.thinking}`);
  if (agent.output) lines.push(`Output: ${agent.output}`);
  if (agent.defaultReads?.length) lines.push(`Reads: ${agent.defaultReads.join(", ")}`);
  if (agent.defaultProgress) lines.push("Progress: true");
  if (agent.maxSubagentDepth !== undefined) lines.push(`Max subagent depth: ${agent.maxSubagentDepth}`);
  if (agent.systemPrompt.trim()) lines.push("", "System Prompt:", agent.systemPrompt);
  return lines.join("\n");
}

function formatChainDetail(chain) {
  const lines = [`Chain: ${chain.name} (${chain.source})`, `Path: ${chain.filePath}`, `Description: ${chain.description}`];
  if (chain.packageName) {
    lines.push(`Local name: ${(0, _agents.frontmatterNameForConfig)(chain)}`);
    lines.push(`Package: ${chain.packageName}`);
  }
  lines.push("", "Steps:");
  for (let i = 0; i < chain.steps.length; i++) {
    const s = chain.steps[i];
    lines.push(`${i + 1}. ${s.agent}`);
    if (s.task.trim()) lines.push(`   Task: ${s.task}`);
    if (s.output === false) lines.push("   Output: false");else
    if (s.output) lines.push(`   Output: ${s.output}`);
    if (s.outputMode) lines.push(`   Output mode: ${s.outputMode}`);
    if (s.reads === false) lines.push("   Reads: false");else
    if (Array.isArray(s.reads) && s.reads.length > 0) lines.push(`   Reads: ${s.reads.join(", ")}`);
    if (s.model) lines.push(`   Model: ${s.model}`);
    if (s.skills === false) lines.push("   Skills: false");else
    if (Array.isArray(s.skills) && s.skills.length > 0) lines.push(`   Skills: ${s.skills.join(", ")}`);
    if (s.progress !== undefined) lines.push(`   Progress: ${s.progress ? "true" : "false"}`);
  }
  return lines.join("\n");
}

function handleList(params, ctx) {
  const scope = normalizeListScope(params.agentScope) ?? "both";
  const d = (0, _agents.discoverAgentsAll)(ctx.cwd);
  const scopedAgents = allAgents(d).filter((a) => scope === "both" || a.source === "builtin" || a.source === scope).sort((a, b) => a.name.localeCompare(b.name));
  const agents = scopedAgents.filter((a) => !a.disabled);
  const chains = d.chains.filter((c) => scope === "both" || c.source === scope).sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
  "Executable agents:",
  ...(agents.length ?
  agents.map((a) => `- ${a.name} (${a.source}${a.defaultContext ? `, context: ${a.defaultContext}` : ""}): ${a.description}`) :
  ["- (none)"]),
  "",
  "Chains:",
  ...(chains.length ? chains.map((c) => `- ${c.name} (${c.source}): ${c.description}`) : ["- (none)"])];

  return result(lines.join("\n"));
}

function handleGet(params, ctx) {
  if (!params.agent && !params.chainName) return result("Specify 'agent' or 'chainName' for get.", true);
  const hasBoth = Boolean(params.agent && params.chainName);
  const blocks = [];
  let anyFound = false;
  if (params.agent) {
    const matches = findAgents(params.agent, ctx.cwd, "both");
    if (!matches.length) {
      const msg = `Agent '${params.agent}' not found. Available: ${availableNames(ctx.cwd, "agent").join(", ") || "none"}.`;
      if (!hasBoth) return result(msg, true);
      blocks.push(msg);
    } else {
      anyFound = true;
      blocks.push(...matches.map(formatAgentDetail));
    }
  }
  if (params.chainName) {
    const matches = findChains(params.chainName, ctx.cwd, "both");
    if (!matches.length) {
      const msg = `Chain '${params.chainName}' not found. Available: ${availableNames(ctx.cwd, "chain").join(", ") || "none"}.`;
      if (!hasBoth) return result(msg, true);
      blocks.push(msg);
    } else {
      anyFound = true;
      blocks.push(...matches.map(formatChainDetail));
    }
  }
  return result(blocks.join("\n\n"), !anyFound);
}

function handleCreate(params, ctx) {
  const parsedConfig = configObject(params.config);
  if (parsedConfig.error) return result(parsedConfig.error, true);
  const cfg = parsedConfig.value;
  if (!cfg) return result("config required for create.", true);
  if (typeof cfg.name !== "string" || !cfg.name.trim()) return result("config.name is required and must be a non-empty string.", true);
  if (typeof cfg.description !== "string" || !cfg.description.trim()) return result("config.description is required and must be a non-empty string.", true);
  const name = sanitizeName(cfg.name);
  if (!name) return result("config.name is invalid after sanitization. Use letters, numbers, spaces, or hyphens.", true);
  const parsedPackage = parsePackageConfig(cfg.package);
  if (parsedPackage.error) return result(parsedPackage.error, true);
  const runtimeName = (0, _agents.buildRuntimeName)(name, parsedPackage.packageName);
  const scopeRaw = cfg.scope ?? "user";
  if (scopeRaw !== "user" && scopeRaw !== "project") return result("config.scope must be 'user' or 'project'.", true);
  const scope = scopeRaw;
  const isChain = hasKey(cfg, "steps");
  const d = (0, _agents.discoverAgentsAll)(ctx.cwd);
  const targetDir = isChain ?
  scope === "user" ? d.userChainDir : d.projectChainDir ?? path.join(ctx.cwd, ".pi", "chains") :
  scope === "user" ? d.userDir : d.projectDir ?? path.join(ctx.cwd, ".pi", "agents");
  fs.mkdirSync(targetDir, { recursive: true });
  if (nameExistsInScope(ctx.cwd, scope, runtimeName)) return result(`Name '${runtimeName}' already exists in ${scope} scope. Use update instead.`, true);
  const targetPath = path.join(targetDir, isChain ? `${runtimeName}.chain.md` : `${runtimeName}.md`);
  if (fs.existsSync(targetPath)) return result(`File already exists at ${targetPath} but is not a valid ${isChain ? "chain" : "agent"} definition. Remove or rename it first.`, true);
  const warnings = [];
  if (!isChain && d.builtin.some((a) => a.name === runtimeName)) warnings.push(`Note: this shadows the builtin agent '${runtimeName}'.`);
  if (isChain) {
    const parsed = parseStepList(cfg.steps);
    if (parsed.error) return result(parsed.error, true);
    const chain = { name: runtimeName, localName: name, packageName: parsedPackage.packageName, description: cfg.description.trim(), source: scope, filePath: targetPath, steps: parsed.steps };
    fs.writeFileSync(targetPath, (0, _chainSerializer.serializeChain)(chain), "utf-8");
    const missing = unknownChainAgents(ctx.cwd, chain.steps);
    if (missing.length) warnings.push(`Warning: chain steps reference unknown agents: ${missing.join(", ")}.`);
    warnings.push(...chainStepWarnings(ctx, chain.steps));
    return result([`Created chain '${runtimeName}' at ${targetPath}.`, ...warnings].join("\n"));
  }
  const agent = {
    name: runtimeName,
    localName: name,
    packageName: parsedPackage.packageName,
    description: cfg.description.trim(),
    source: scope,
    filePath: targetPath,
    systemPrompt: "",
    systemPromptMode: (0, _agents.defaultSystemPromptMode)(name),
    inheritProjectContext: (0, _agents.defaultInheritProjectContext)(name),
    inheritSkills: (0, _agents.defaultInheritSkills)()
  };
  const applyError = applyAgentConfig(agent, cfg);
  if (applyError) return result(applyError, true);
  const mw = modelWarning(ctx, agent.model);
  if (mw) warnings.push(mw);
  const fmw = fallbackModelsWarning(ctx, agent.fallbackModels);
  if (fmw) warnings.push(fmw);
  const sw = skillsWarning(ctx.cwd, agent.skills);
  if (sw) warnings.push(sw);
  fs.writeFileSync(targetPath, (0, _agentSerializer.serializeAgent)(agent), "utf-8");
  return result([`Created agent '${runtimeName}' at ${targetPath}.`, ...warnings].join("\n"));
}

function handleUpdate(params, ctx) {
  if (!params.agent && !params.chainName) return result("Specify 'agent' or 'chainName' for update.", true);
  if (params.agent && params.chainName) return result("Specify either 'agent' or 'chainName', not both.", true);
  const parsedConfig = configObject(params.config);
  if (parsedConfig.error) return result(parsedConfig.error, true);
  const cfg = parsedConfig.value;
  if (!cfg) return result("config required for update.", true);
  const warnings = [];
  if (params.agent) {
    const scopeHint = asDisambiguationScope(params.agentScope);
    const targetOrError = resolveTarget("agent", params.agent, findAgents(params.agent, ctx.cwd, scopeHint ?? "both"), ctx.cwd, params.agentScope);
    if ("content" in targetOrError) return targetOrError;
    const target = targetOrError;
    const updated = { ...target };
    const oldName = target.name;
    if (hasKey(cfg, "name") && (typeof cfg.name !== "string" || !cfg.name.trim())) return result("config.name must be a non-empty string when provided.", true);
    if (hasKey(cfg, "description") && (typeof cfg.description !== "string" || !cfg.description.trim())) return result("config.description must be a non-empty string when provided.", true);
    let newLocalName = target.localName ?? (0, _agents.frontmatterNameForConfig)(target);
    if (hasKey(cfg, "name")) {
      newLocalName = sanitizeName(cfg.name);
      if (!newLocalName) return result("config.name is invalid after sanitization.", true);
    }
    let newPackageName = target.packageName;
    if (hasKey(cfg, "package")) {
      const parsedPackage = parsePackageConfig(cfg.package);
      if (parsedPackage.error) return result(parsedPackage.error, true);
      newPackageName = parsedPackage.packageName;
    }
    const applyError = applyAgentConfig(updated, cfg);
    if (applyError) return result(applyError, true);
    updated.localName = newLocalName;
    updated.packageName = newPackageName;
    updated.name = (0, _agents.buildRuntimeName)(newLocalName, newPackageName);
    if (hasKey(cfg, "description")) updated.description = cfg.description.trim();
    if (hasKey(cfg, "model")) {
      const mw = modelWarning(ctx, updated.model);
      if (mw) warnings.push(mw);
    }
    if (hasKey(cfg, "fallbackModels")) {
      const fmw = fallbackModelsWarning(ctx, updated.fallbackModels);
      if (fmw) warnings.push(fmw);
    }
    if (hasKey(cfg, "skills")) {
      const sw = skillsWarning(ctx.cwd, updated.skills);
      if (sw) warnings.push(sw);
    }
    if (updated.name !== oldName) {
      const renamed = renamePath("agent", target.filePath, updated.name, target.source, ctx.cwd);
      if (renamed.error) return result(renamed.error, true);
      updated.filePath = renamed.filePath;
    }
    fs.writeFileSync(updated.filePath, (0, _agentSerializer.serializeAgent)(updated), "utf-8");
    if (updated.name !== oldName) {
      const refs = (0, _agents.discoverAgentsAll)(ctx.cwd).chains.filter((c) => c.steps.some((s) => s.agent === oldName)).map((c) => `${c.name} (${c.source})`);
      if (refs.length) warnings.push(`Warning: chains still reference '${oldName}': ${refs.join(", ")}.`);
    }
    const headline = updated.name === oldName ?
    `Updated agent '${updated.name}' at ${updated.filePath}.` :
    `Updated agent '${oldName}' to '${updated.name}' at ${updated.filePath}.`;
    return result([headline, ...warnings].join("\n"));
  }
  const scopeHint = asDisambiguationScope(params.agentScope);
  const targetOrError = resolveTarget("chain", params.chainName, findChains(params.chainName, ctx.cwd, scopeHint ?? "both"), ctx.cwd, params.agentScope);
  if ("content" in targetOrError) return targetOrError;
  const target = targetOrError;
  const updated = { ...target, steps: [...target.steps] };
  const oldName = target.name;
  if (hasKey(cfg, "name") && (typeof cfg.name !== "string" || !cfg.name.trim())) return result("config.name must be a non-empty string when provided.", true);
  if (hasKey(cfg, "description") && (typeof cfg.description !== "string" || !cfg.description.trim())) return result("config.description must be a non-empty string when provided.", true);
  let newLocalName = target.localName ?? (0, _agents.frontmatterNameForConfig)(target);
  if (hasKey(cfg, "name")) {
    newLocalName = sanitizeName(cfg.name);
    if (!newLocalName) return result("config.name is invalid after sanitization.", true);
  }
  let newPackageName = target.packageName;
  if (hasKey(cfg, "package")) {
    const parsedPackage = parsePackageConfig(cfg.package);
    if (parsedPackage.error) return result(parsedPackage.error, true);
    newPackageName = parsedPackage.packageName;
  }
  let parsedSteps;
  if (hasKey(cfg, "steps")) {
    const parsed = parseStepList(cfg.steps);
    if (parsed.error) return result(parsed.error, true);
    parsedSteps = parsed.steps;
  }
  updated.localName = newLocalName;
  updated.packageName = newPackageName;
  updated.name = (0, _agents.buildRuntimeName)(newLocalName, newPackageName);
  if (hasKey(cfg, "description")) updated.description = cfg.description.trim();
  if (parsedSteps) {
    updated.steps = parsedSteps;
    const missing = unknownChainAgents(ctx.cwd, updated.steps);
    if (missing.length) warnings.push(`Warning: chain steps reference unknown agents: ${missing.join(", ")}.`);
    warnings.push(...chainStepWarnings(ctx, updated.steps));
  }
  if (updated.name !== oldName) {
    const renamed = renamePath("chain", target.filePath, updated.name, target.source, ctx.cwd);
    if (renamed.error) return result(renamed.error, true);
    updated.filePath = renamed.filePath;
  }
  fs.writeFileSync(updated.filePath, (0, _chainSerializer.serializeChain)(updated), "utf-8");
  const headline = updated.name === oldName ?
  `Updated chain '${updated.name}' at ${updated.filePath}.` :
  `Updated chain '${oldName}' to '${updated.name}' at ${updated.filePath}.`;
  return result([headline, ...warnings].join("\n"));
}

function handleDelete(params, ctx) {
  if (!params.agent && !params.chainName) return result("Specify 'agent' or 'chainName' for delete.", true);
  if (params.agent && params.chainName) return result("Specify either 'agent' or 'chainName', not both.", true);
  const scopeHint = asDisambiguationScope(params.agentScope);
  if (params.agent) {
    const targetOrError = resolveTarget("agent", params.agent, findAgents(params.agent, ctx.cwd, scopeHint ?? "both"), ctx.cwd, params.agentScope);
    if ("content" in targetOrError) return targetOrError;
    const target = targetOrError;
    fs.unlinkSync(target.filePath);
    const refs = (0, _agents.discoverAgentsAll)(ctx.cwd).chains.filter((c) => c.steps.some((s) => s.agent === target.name)).map((c) => `${c.name} (${c.source})`);
    const lines = [`Deleted agent '${target.name}' at ${target.filePath}.`];
    if (refs.length) lines.push(`Warning: chains reference deleted agent '${target.name}': ${refs.join(", ")}.`);
    return result(lines.join("\n"));
  }
  const targetOrError = resolveTarget("chain", params.chainName, findChains(params.chainName, ctx.cwd, scopeHint ?? "both"), ctx.cwd, params.agentScope);
  if ("content" in targetOrError) return targetOrError;
  const target = targetOrError;
  fs.unlinkSync(target.filePath);
  return result(`Deleted chain '${target.name}' at ${target.filePath}.`);
}

function handleManagementAction(action, params, ctx) {
  switch (action) {
    case "list":return handleList(params, ctx);
    case "get":return handleGet(params, ctx);
    case "create":return handleCreate(params, ctx);
    case "update":return handleUpdate(params, ctx);
    case "delete":return handleDelete(params, ctx);
    default:return result(`Unknown action: ${action}`, true);
  }
} /* v9-f1aaa04295c5b5e7 */
