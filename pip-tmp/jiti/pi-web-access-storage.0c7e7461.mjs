"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.clearResults = clearResults;exports.deleteResult = deleteResult;exports.generateId = generateId;exports.getAllResults = getAllResults;exports.getResult = getResult;exports.restoreFromSession = restoreFromSession;exports.storeResult = storeResult;



const CACHE_TTL_MS = 60 * 60 * 1000;

















const storedResults = new Map();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function storeResult(id, data) {
  storedResults.set(id, data);
}

function getResult(id) {
  return storedResults.get(id) ?? null;
}

function getAllResults() {
  return Array.from(storedResults.values());
}

function deleteResult(id) {
  return storedResults.delete(id);
}

function clearResults() {
  storedResults.clear();
}

function isValidStoredData(data) {
  if (!data || typeof data !== "object") return false;
  const d = data;
  if (typeof d.id !== "string" || !d.id) return false;
  if (d.type !== "search" && d.type !== "fetch") return false;
  if (typeof d.timestamp !== "number") return false;
  if (d.type === "search" && !Array.isArray(d.queries)) return false;
  if (d.type === "fetch" && !Array.isArray(d.urls)) return false;
  return true;
}

function restoreFromSession(ctx) {
  storedResults.clear();
  const now = Date.now();

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "web-search-results") {
      const data = entry.data;
      if (isValidStoredData(data) && now - data.timestamp < CACHE_TTL_MS) {
        storedResults.set(data.id, data);
      }
    }
  }
} /* v9-ba82a99a4c640321 */
