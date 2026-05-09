"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.executeCodeSearch = executeCodeSearch;var _activity = await jitiImport("./activity.js");
var _exa = await jitiImport("./exa.js");

const CODE_CONTEXT_TOOL = "get_code_context_exa";
const WEB_SEARCH_TOOL = "web_search_exa";
const DEFAULT_MAX_TOKENS = 5000;

let codeContextToolMissing = false;

function isMissingMcpToolError(message) {
  const normalized = message.toLowerCase();
  return normalized.includes("tool") && normalized.includes("not found");
}

function buildFallbackQuery(query) {
  const normalized = query.toLowerCase();
  const hasCodeTerms = /\b(api|code|docs?|documentation|example|github|implementation|library|source|stackoverflow|stack overflow)\b/.test(normalized);
  return hasCodeTerms ? query : `${query} code examples documentation GitHub Stack Overflow official docs`;
}

function maxTokensToResultCount(maxTokens) {
  return Math.min(20, Math.max(5, Math.ceil(maxTokens / 1000)));
}

function trimApproxTokens(text, maxTokens) {
  const maxCharacters = Math.max(1000, maxTokens * 4);
  if (text.length <= maxCharacters) return text;
  return `${text.slice(0, maxCharacters).trimEnd()}\n\n[Truncated by code_search to approximately ${maxTokens} tokens.]`;
}

async function executeFallbackSearch(query, maxTokens, signal) {
  const text = await (0, _exa.callExaMcp)(
    WEB_SEARCH_TOOL,
    {
      query: buildFallbackQuery(query),
      numResults: maxTokensToResultCount(maxTokens),
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: Math.min(50000, Math.max(1000, maxTokens * 4))
    },
    signal
  );
  return trimApproxTokens(text, maxTokens);
}

async function executeCodeSearch(
_toolCallId,
params,
signal)



{
  const query = params.query.trim();
  if (!query) {
    return {
      content: [{ type: "text", text: "Error: No query provided." }],
      details: { query: "", maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS, error: "No query provided" }
    };
  }

  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const activityId = _activity.activityMonitor.logStart({ type: "api", query });

  try {
    let mode = "web-search-fallback";
    let text;

    if (codeContextToolMissing) {
      text = await executeFallbackSearch(query, maxTokens, signal);
    } else {
      try {
        text = await (0, _exa.callExaMcp)(
          CODE_CONTEXT_TOOL,
          {
            query,
            tokensNum: maxTokens
          },
          signal
        );
        mode = "code-context";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isMissingMcpToolError(message)) throw err;
        codeContextToolMissing = true;
        text = await executeFallbackSearch(query, maxTokens, signal);
      }
    }

    _activity.activityMonitor.logComplete(activityId, 200);
    return {
      content: [{ type: "text", text }],
      details: { query, maxTokens, mode }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) {
      _activity.activityMonitor.logComplete(activityId, 0);
      throw err;
    }
    _activity.activityMonitor.logError(activityId, message);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      details: { query, maxTokens, error: message }
    };
  }
} /* v9-7cb6dc1a8d8e5070 */
