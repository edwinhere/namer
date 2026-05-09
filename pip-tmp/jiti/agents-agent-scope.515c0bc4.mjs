"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.resolveExecutionAgentScope = resolveExecutionAgentScope;

function resolveExecutionAgentScope(scope) {
  if (scope === "user" || scope === "project" || scope === "both") return scope;
  return "both";
} /* v9-28865fb4666b353e */
