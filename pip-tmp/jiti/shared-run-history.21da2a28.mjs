"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.loadRunsForAgent = loadRunsForAgent;exports.recordRun = recordRun;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var os = _interopRequireWildcard(await jitiImport("node:os"));
var path = _interopRequireWildcard(await jitiImport("node:path"));function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}










const HISTORY_PATH = path.join(os.homedir(), ".pi", "agent", "run-history.jsonl");
const ROTATE_READ_THRESHOLD = 1200;
const ROTATE_KEEP = 1000;

function recordRun(agent, task, exitCode, durationMs) {
  try {
    const entry = {
      agent,
      task: task.slice(0, 200),
      ts: Math.floor(Date.now() / 1000),
      status: exitCode === 0 ? "ok" : "error",
      duration: durationMs,
      ...(exitCode !== 0 ? { exit: exitCode } : {})
    };
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(entry)}\n`);
  } catch {

    // Best-effort — never crash the execution flow for history recording
  }}

function loadRunsForAgent(agent) {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  let raw;
  try {
    raw = fs.readFileSync(HISTORY_PATH, "utf-8");
  } catch {
    return [];
  }

  let lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  if (lines.length > ROTATE_READ_THRESHOLD) {
    lines = lines.slice(-ROTATE_KEEP);
    try {fs.writeFileSync(HISTORY_PATH, `${lines.join("\n")}\n`, "utf-8");} catch {}
  }

  return lines.
  map((line) => {try {return JSON.parse(line);} catch {return undefined;}}).
  filter((entry) => Boolean(entry) && entry.agent === agent).
  reverse();
} /* v9-9c5d87a78677e669 */
