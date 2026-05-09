"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.getPiSpawnCommand = getPiSpawnCommand;exports.resolvePiPackageRoot = resolvePiPackageRoot;exports.resolveWindowsPiCliScript = resolveWindowsPiCliScript;var fs = _interopRequireWildcard(await jitiImport("node:fs"));
var _nodeModule = await jitiImport("node:module");
var path = _interopRequireWildcard(await jitiImport("node:path"));function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}

const _require = (0, _nodeModule.createRequire)("file:///home/edwin/.config/nvm/versions/node/v22.20.0/lib/node_modules/pi-subagents/src/runs/shared/pi-spawn.ts");

function resolvePiPackageRoot() {
  try {
    const entry = process.argv[1];
    if (!entry) return undefined;
    let dir = path.dirname(fs.realpathSync(entry));
    while (dir !== path.dirname(dir)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
        if (pkg.name === "@mariozechner/pi-coding-agent") return dir;
      } catch {}
      dir = path.dirname(dir);
    }
  } catch {}
  return undefined;
}
















function isRunnableNodeScript(filePath, existsSync) {
  if (!existsSync(filePath)) return false;
  return /\.(?:mjs|cjs|js)$/i.test(filePath);
}

function normalizePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

function resolveWindowsPiCliScript(deps = {}) {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));
  const argv1 = deps.argv1 ?? process.argv[1];

  if (argv1) {
    const argvPath = normalizePath(argv1);
    if (isRunnableNodeScript(argvPath, existsSync)) {
      return argvPath;
    }
  }

  try {
    const resolvePackageJson = deps.resolvePackageJson ?? (() => {
      const root = deps.piPackageRoot ?? resolvePiPackageRoot();
      if (root) return path.join(root, "package.json");
      return _require.resolve("@mariozechner/pi-coding-agent/package.json");
    });
    const packageJsonPath = resolvePackageJson();
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));


    const binField = packageJson.bin;
    const binPath = typeof binField === "string" ?
    binField :
    binField?.pi ?? Object.values(binField ?? {})[0];
    if (!binPath) return undefined;
    const candidate = normalizePath(path.resolve(path.dirname(packageJsonPath), binPath));
    if (isRunnableNodeScript(candidate, existsSync)) {
      return candidate;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getPiSpawnCommand(args, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    const piCliPath = resolveWindowsPiCliScript(deps);
    if (piCliPath) {
      return {
        command: deps.execPath ?? process.execPath,
        args: [piCliPath, ...args]
      };
    }
  }

  return { command: "pi", args };
} /* v9-e28aa7218c943c8a */
