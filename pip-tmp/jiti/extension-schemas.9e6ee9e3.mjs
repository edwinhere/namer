"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.SubagentParams = void 0;



var _typebox = await jitiImport("typebox");
var _types = await jitiImport("../shared/types.ts"); /**
 * TypeBox schemas for subagent tool parameters
 */const SkillOverride = _typebox.Type.Unsafe({
  anyOf: [
  { type: "array", items: { type: "string" } },
  { type: "boolean" },
  { type: "string" }],

  description: "Skill name(s) to inject (comma-separated), array of strings, or boolean (false disables, true uses default)"
});

const OutputOverride = _typebox.Type.Unsafe({
  anyOf: [
  { type: "string" },
  { type: "boolean" }],

  description: "Output filename/path (string), or false to disable file output"
});

const OutputModeOverride = _typebox.Type.String({
  enum: ["inline", "file-only"],
  description: "Return saved output inline (default) or only a concise file reference. file-only requires output to be a path."
});

const ReadsOverride = _typebox.Type.Unsafe({
  anyOf: [
  { type: "array", items: { type: "string" } },
  { type: "boolean" }],

  description: "Files to read before running (array of filenames), or false to disable"
});

const TaskItem = _typebox.Type.Object({
  agent: _typebox.Type.String(),
  task: _typebox.Type.String(),
  cwd: _typebox.Type.Optional(_typebox.Type.String()),
  count: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Repeat this parallel task N times with the same settings." })),
  output: _typebox.Type.Optional(OutputOverride),
  outputMode: _typebox.Type.Optional(OutputModeOverride),
  reads: _typebox.Type.Optional(ReadsOverride),
  progress: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Enable progress.md tracking for this task" })),
  model: _typebox.Type.Optional(_typebox.Type.String({ description: "Override model for this task (e.g. 'google/gemini-3-pro')" })),
  skill: _typebox.Type.Optional(SkillOverride)
});

// Parallel task item (within a parallel step)
const ParallelTaskSchema = _typebox.Type.Object({
  agent: _typebox.Type.String(),
  task: _typebox.Type.Optional(_typebox.Type.String({ description: "Task template with {task}, {previous}, {chain_dir} variables. Defaults to {previous}." })),
  cwd: _typebox.Type.Optional(_typebox.Type.String()),
  count: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Repeat this parallel task N times with the same settings." })),
  output: _typebox.Type.Optional(OutputOverride),
  outputMode: _typebox.Type.Optional(OutputModeOverride),
  reads: _typebox.Type.Optional(ReadsOverride),
  progress: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Enable progress.md tracking in {chain_dir}" })),
  skill: _typebox.Type.Optional(SkillOverride),
  model: _typebox.Type.Optional(_typebox.Type.String({ description: "Override model for this task" }))
});

// Flattened so chain steps do not need an object-shape anyOf/oneOf union.
const ChainItem = _typebox.Type.Object({
  agent: _typebox.Type.Optional(_typebox.Type.String({ description: "Sequential step agent name" })),
  task: _typebox.Type.Optional(_typebox.Type.String({
    description: "Task template with variables: {task}=original request, {previous}=prior step's text response, {chain_dir}=shared folder. Required for first step, defaults to '{previous}' for subsequent steps."
  })),
  cwd: _typebox.Type.Optional(_typebox.Type.String()),
  output: _typebox.Type.Optional(OutputOverride),
  outputMode: _typebox.Type.Optional(OutputModeOverride),
  reads: _typebox.Type.Optional(ReadsOverride),
  progress: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Enable progress.md tracking in {chain_dir}" })),
  skill: _typebox.Type.Optional(SkillOverride),
  model: _typebox.Type.Optional(_typebox.Type.String({ description: "Override model for this step" })),
  parallel: _typebox.Type.Optional(_typebox.Type.Array(ParallelTaskSchema, { minItems: 1, description: "Tasks to run in parallel" })),
  concurrency: _typebox.Type.Optional(_typebox.Type.Number({ description: "Max concurrent tasks (default: 4)" })),
  failFast: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Stop on first failure (default: false)" })),
  worktree: _typebox.Type.Optional(_typebox.Type.Boolean({
    description: "Create isolated git worktrees for each parallel task."
  }))
}, { description: "Chain step: use {agent, task?, ...} for sequential or {parallel: [...]} for concurrent execution" });

const ControlOverrides = _typebox.Type.Object({
  enabled: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Enable/disable subagent control attention tracking for this run" })),
  needsAttentionAfterMs: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "No-observed-activity window before a run needs attention" })),
  activeNoticeAfterMs: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Active-long-running notice threshold by elapsed ms (default: 240000)" })),
  activeNoticeAfterTurns: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Optional active-long-running notice threshold by assistant turns (disabled by default)" })),
  activeNoticeAfterTokens: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Optional active-long-running notice threshold by total tokens (disabled by default)" })),
  failedToolAttemptsBeforeAttention: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Consecutive mutating-tool failures before escalating to needs_attention (default: 3)" })),
  notifyOn: _typebox.Type.Optional(_typebox.Type.Array(_typebox.Type.String({ enum: ["active_long_running", "needs_attention"] }), {
    description: "Control event types that should notify the parent/orchestrator. Defaults to active_long_running and needs_attention."
  })),
  notifyChannels: _typebox.Type.Optional(_typebox.Type.Array(_typebox.Type.String({ enum: ["event", "async", "intercom"] }), {
    description: "Notification channels to use when available. Defaults to event, async, and intercom."
  }))
});

const SubagentParams = exports.SubagentParams = _typebox.Type.Object({
  agent: _typebox.Type.Optional(_typebox.Type.String({ description: "Agent name (SINGLE mode) or target for management get/update/delete" })),
  task: _typebox.Type.Optional(_typebox.Type.String({ description: "Task (SINGLE mode, optional for self-contained agents)" })),
  // Management action (when present, tool operates in management mode)
  action: _typebox.Type.Optional(_typebox.Type.String({
    enum: [..._types.SUBAGENT_ACTIONS],
    description: "Management/control action. Omit for execution mode."
  })),
  id: _typebox.Type.Optional(_typebox.Type.String({
    description: "Run id or prefix for action='status', action='interrupt', or action='resume'."
  })),
  runId: _typebox.Type.Optional(_typebox.Type.String({
    description: "Target run ID for action='interrupt' or action='resume'. Defaults to the most recently active controllable run for interrupt. Prefer id for new calls."
  })),
  dir: _typebox.Type.Optional(_typebox.Type.String({
    description: "Async run directory for action='status' or action='resume'."
  })),
  index: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 0, description: "Zero-based child index for actions that target a specific child." })),
  message: _typebox.Type.Optional(_typebox.Type.String({ description: "Follow-up message for action='resume'. Use index to choose a child from multi-child runs." })),
  // Chain identifier for management (can't reuse 'chain' — that's the execution array)
  chainName: _typebox.Type.Optional(_typebox.Type.String({
    description: "Chain name for get/update/delete management actions"
  })),
  // Agent/chain configuration for create/update (nested to avoid conflicts with execution fields)
  config: _typebox.Type.Optional(_typebox.Type.Unsafe({
    anyOf: [
    { type: "object", additionalProperties: true },
    { type: "string" }],

    description: "Agent or chain config for create/update. Agent: name, package (optional namespace; runtime name becomes package.name), description, scope ('user'|'project', default 'user'), systemPrompt, systemPromptMode, inheritProjectContext, inheritSkills, defaultContext ('fresh'|'fork'), model, tools (comma-separated), extensions (comma-separated), skills (comma-separated), thinking, output, reads, progress, maxSubagentDepth. Chain: name, package, description, scope, steps (array of {agent, task?, output?, outputMode?, reads?, model?, skill?, progress?}). Presence of 'steps' creates a chain instead of an agent. String values must be valid JSON."
  })),
  tasks: _typebox.Type.Optional(_typebox.Type.Array(TaskItem, { description: "PARALLEL mode: [{agent, task, count?, output?, outputMode?, reads?, progress?}, ...]" })),
  concurrency: _typebox.Type.Optional(_typebox.Type.Integer({ minimum: 1, description: "Top-level PARALLEL mode only: max concurrent tasks. Defaults to config.parallel.concurrency or 4." })),
  worktree: _typebox.Type.Optional(_typebox.Type.Boolean({
    description: "Create isolated git worktrees for each parallel task. " +
    "Prevents filesystem conflicts. Requires clean git state. " +
    "Per-worktree diffs included in output."
  })),
  chain: _typebox.Type.Optional(_typebox.Type.Array(ChainItem, { description: "CHAIN mode: sequential pipeline where each step's response becomes {previous} for the next. Use {task}, {previous}, {chain_dir} in task templates." })),
  context: _typebox.Type.Optional(_typebox.Type.String({
    enum: ["fresh", "fork"],
    description: "'fresh' or 'fork' to branch from parent session. If omitted, any requested agent with defaultContext: 'fork' makes the whole invocation forked; otherwise the default is 'fresh'."
  })),
  chainDir: _typebox.Type.Optional(_typebox.Type.String({ description: "Persistent directory for chain artifacts. Default: a user-scoped temp directory under <tmpdir>/ (auto-cleaned after 24h)" })),
  async: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Run in background (default: false, or per config)" })),
  agentScope: _typebox.Type.Optional(_typebox.Type.String({ description: "Agent discovery scope: 'user', 'project', or 'both' (default: 'both'; project wins on name collisions)" })),
  cwd: _typebox.Type.Optional(_typebox.Type.String()),
  artifacts: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Write debug artifacts (default: true)" })),
  includeProgress: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Include full progress in result (default: false)" })),
  share: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Upload session to GitHub Gist for sharing (default: false)" })),
  sessionDir: _typebox.Type.Optional(
    _typebox.Type.String({ description: "Directory to store session logs (default: temp; enables sessions even if share=false)" })
  ),
  // Clarification TUI
  clarify: _typebox.Type.Optional(_typebox.Type.Boolean({ description: "Show TUI to preview/edit before execution (default: true for chains, false for single/parallel). Implies sync mode." })),
  control: _typebox.Type.Optional(ControlOverrides),
  // Solo agent overrides
  output: _typebox.Type.Optional(_typebox.Type.Unsafe({
    anyOf: [
    { type: "string" },
    { type: "boolean" }],

    description: "Output file for single agent (string), or false to disable. Relative paths resolve against cwd."
  })),
  outputMode: _typebox.Type.Optional(OutputModeOverride),
  skill: _typebox.Type.Optional(SkillOverride),
  model: _typebox.Type.Optional(_typebox.Type.String({ description: "Override model for single agent (e.g. 'anthropic/claude-sonnet-4')" }))
}); /* v9-1f42c6bb141b9221 */
