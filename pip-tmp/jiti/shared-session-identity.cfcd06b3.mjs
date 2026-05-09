"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.resolveCurrentSessionId = resolveCurrentSessionId;




function resolveCurrentSessionId(sessionManager) {
  const sessionId = sessionManager.getSessionFile() ?? sessionManager.getSessionId();
  if (!sessionId) throw new Error("Current session identity is unavailable.");
  return sessionId;
} /* v9-3e5650ea8c9543e4 */
