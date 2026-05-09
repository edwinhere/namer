"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.applyForceTopLevelAsyncOverride = applyForceTopLevelAsyncOverride;




function applyForceTopLevelAsyncOverride(
params,
depth,
forceTopLevelAsync)
{
  if (!(depth === 0 && forceTopLevelAsync)) return params;
  return { ...params, async: true, clarify: false };
} /* v9-477ca4de2563a7d0 */
