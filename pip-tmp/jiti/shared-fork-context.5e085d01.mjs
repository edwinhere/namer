"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.createForkContextResolver = createForkContextResolver;exports.resolveSubagentContext = resolveSubagentContext;















function resolveSubagentContext(value) {
  return value === "fork" ? "fork" : "fresh";
}

function createForkContextResolver(
sessionManager,
requestedContext)
{
  if (resolveSubagentContext(requestedContext) !== "fork") {
    return {
      sessionFileForIndex: () => undefined
    };
  }

  const parentSessionFile = sessionManager.getSessionFile();
  if (!parentSessionFile) {
    throw new Error("Forked subagent context requires a persisted parent session.");
  }

  const leafId = sessionManager.getLeafId();
  if (!leafId) {
    throw new Error("Forked subagent context requires a current leaf to fork from.");
  }

  const cachedSessionFiles = new Map();

  return {
    sessionFileForIndex(index = 0) {
      const cached = cachedSessionFiles.get(index);
      if (cached) return cached;
      try {
        const sourceManager = sessionManager.constructor.open(parentSessionFile);
        const sessionFile = sourceManager.createBranchedSession(leafId);
        if (!sessionFile) {
          throw new Error("Session manager did not return a session file.");
        }
        cachedSessionFiles.set(index, sessionFile);
        return sessionFile;
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new Error(`Failed to create forked subagent session: ${cause.message}`, { cause });
      }
    }
  };
} /* v9-9d8b627cab3c6f76 */
