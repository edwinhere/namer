"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.createJsonlWriter = createJsonlWriter;var fs = _interopRequireWildcard(await jitiImport("node:fs"));function _interopRequireWildcard(e, t) {if ("function" == typeof WeakMap) var r = new WeakMap(),n = new WeakMap();return (_interopRequireWildcard = function (e, t) {if (!t && e && e.__esModule) return e;var o,i,f = { __proto__: null, default: e };if (null === e || "object" != typeof e && "function" != typeof e) return f;if (o = t ? n : r) {if (o.has(e)) return o.get(e);o.set(e, f);}for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]);return f;})(e, t);}












const DEFAULT_MAX_JSONL_BYTES = 50 * 1024 * 1024;











function createJsonlWriter(
filePath,
source,
deps = {})
{
  if (!filePath) {
    return {
      writeLine() {},
      async close() {}
    };
  }

  const createWriteStream = deps.createWriteStream ?? ((targetPath) => fs.createWriteStream(targetPath, { flags: "a" }));
  let stream;
  try {
    stream = createWriteStream(filePath);
  } catch {
    return {
      writeLine() {},
      async close() {}
    };
  }

  let backpressured = false;
  let closed = false;
  let bytesWritten = 0;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_JSONL_BYTES;

  return {
    writeLine(line) {
      if (!stream || closed || !line.trim()) return;
      const chunk = `${line}\n`;
      const chunkBytes = Buffer.byteLength(chunk, "utf-8");
      if (bytesWritten + chunkBytes > maxBytes) return;
      try {
        const ok = stream.write(chunk);
        bytesWritten += chunkBytes;
        if (!ok && !backpressured) {
          backpressured = true;
          source.pause();
          stream.once("drain", () => {
            backpressured = false;
            if (!closed) source.resume();
          });
        }
      } catch {}
    },
    async close() {
      if (!stream || closed) return;
      closed = true;
      const current = stream;
      stream = undefined;
      await new Promise((resolve) => current.end(() => resolve()));
    }
  };
} /* v9-5b067c579548a1ee */
