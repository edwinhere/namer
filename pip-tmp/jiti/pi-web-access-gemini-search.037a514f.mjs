"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.search = search;var _nodeFs = await jitiImport("node:fs");
var _nodeOs = await jitiImport("node:os");
var _nodePath = await jitiImport("node:path");
var _activity = await jitiImport("./activity.js");
var _geminiApi = await jitiImport("./gemini-api.js");
var _geminiWeb = await jitiImport("./gemini-web.js");
var _perplexity = await jitiImport("./perplexity.js");
var _exa = await jitiImport("./exa.js");








const CONFIG_PATH = (0, _nodePath.join)((0, _nodeOs.homedir)(), ".pi", "web-search.json");

let cachedSearchConfig = null;

function getSearchConfig() {
  if (cachedSearchConfig) return cachedSearchConfig;
  if (!(0, _nodeFs.existsSync)(CONFIG_PATH)) {
    cachedSearchConfig = { searchProvider: "auto", searchModel: undefined };
    return cachedSearchConfig;
  }

  const rawText = (0, _nodeFs.readFileSync)(CONFIG_PATH, "utf-8");
  let raw;




  try {
    raw = JSON.parse(rawText);




  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }

  cachedSearchConfig = {
    searchProvider: normalizeSearchProvider(raw.searchProvider ?? raw.provider),
    searchModel: normalizeSearchModel(raw.searchModel)
  };
  return cachedSearchConfig;
}

function normalizeSearchModel(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSearchProvider(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "auto" || normalized === "perplexity" || normalized === "gemini" || normalized === "exa" ?
  normalized :
  "auto";
}






function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err) {
  return errorMessage(err).toLowerCase().includes("abort");
}

async function searchWithGemini(
query,
options,
strictErrors)
{
  const errors = [];

  try {
    const apiResult = await searchWithGeminiApi(query, options);
    if (apiResult) return apiResult;
  } catch (err) {
    if (isAbortError(err)) throw err;
    errors.push(`Gemini API: ${errorMessage(err)}`);
  }

  try {
    const webResult = await searchWithGeminiWeb(query, options);
    if (webResult) return webResult;
  } catch (err) {
    if (isAbortError(err)) throw err;
    errors.push(`Gemini Web: ${errorMessage(err)}`);
  }

  if (strictErrors && errors.length > 0) {
    throw new Error(`Gemini search failed:\n  - ${errors.join("\n  - ")}`);
  }

  return null;
}

async function search(query, options = {}) {
  const config = getSearchConfig();
  const provider = options.provider ?? config.searchProvider;

  if (provider === "perplexity") {
    const result = await (0, _perplexity.searchWithPerplexity)(query, options);
    return { ...result, provider: "perplexity" };
  }

  if (provider === "gemini") {
    const result = await searchWithGemini(query, options, true);
    if (result) return { ...result, provider: "gemini" };
    throw new Error(
      "Gemini search unavailable. Either:\n" +
      "  1. Set GEMINI_API_KEY in ~/.pi/web-search.json\n" +
      "  2. Sign into gemini.google.com in a supported Chromium-based browser"
    );
  }

  if (provider === "exa") {
    const exaApiKeyConfigured = (0, _exa.hasExaApiKey)();
    try {
      const result = await (0, _exa.searchWithExa)(query, options);
      if (result && "exhausted" in result) {
        throw new Error(
          "Exa monthly free tier exhausted (1,000 requests). Resets next month.\n" +
          "  Use provider: 'perplexity' or 'gemini', or upgrade at exa.ai/pricing"
        );
      }
      if (result && "answer" in result) return { ...result, provider: "exa" };
      if (exaApiKeyConfigured) {
        throw new Error("Exa search returned no results.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes("abort")) throw err;
      if (exaApiKeyConfigured) throw err;
      // No API key: allow provider fallback.
    }
  }

  const fallbackErrors = [];

  if (provider !== "exa" && (0, _exa.isExaAvailable)()) {
    try {
      const result = await (0, _exa.searchWithExa)(query, options);
      if (result && "answer" in result) return { ...result, provider: "exa" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Exa: ${errorMessage(err)}`);
    }
  }

  if ((0, _perplexity.isPerplexityAvailable)()) {
    try {
      const result = await (0, _perplexity.searchWithPerplexity)(query, options);
      return { ...result, provider: "perplexity" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Perplexity: ${errorMessage(err)}`);
    }
  }

  try {
    const geminiResult = await searchWithGemini(query, options, false);
    if (geminiResult) return { ...geminiResult, provider: "gemini" };
  } catch (err) {
    if (isAbortError(err)) throw err;
    fallbackErrors.push(`Gemini: ${errorMessage(err)}`);
  }

  if (fallbackErrors.length > 0) {
    throw new Error(`Auto provider search failed:\n  - ${fallbackErrors.join("\n  - ")}`);
  }

  throw new Error(
    "No search provider available. Either:\n" +
    "  1. Set perplexityApiKey in ~/.pi/web-search.json\n" +
    "  2. Set EXA_API_KEY (or exaApiKey) in ~/.pi/web-search.json\n" +
    "  3. Set GEMINI_API_KEY in ~/.pi/web-search.json\n" +
    "  4. Sign into gemini.google.com in a supported Chromium-based browser"
  );
}

async function searchWithGeminiApi(query, options = {}) {
  const apiKey = (0, _geminiApi.getApiKey)();
  if (!apiKey) return null;

  const activityId = _activity.activityMonitor.logStart({ type: "api", query });

  try {
    const model = getSearchConfig().searchModel ?? _geminiApi.DEFAULT_MODEL;
    const body = {
      contents: [{ parts: [{ text: query }] }],
      tools: [{ google_search: {} }]
    };

    const res = await fetch(`${_geminiApi.API_BASE}/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
      AbortSignal.timeout(60000),
      ...(options.signal ? [options.signal] : [])]
      )
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
    }

    const data = await res.json();
    _activity.activityMonitor.logComplete(activityId, res.status);

    const answer = data.candidates?.[0]?.content?.parts?.
    map((p) => p.text).filter(Boolean).join("\n") ?? "";

    const metadata = data.candidates?.[0]?.groundingMetadata;
    const results = await resolveGroundingChunks(metadata?.groundingChunks, options.signal);

    if (!answer && results.length === 0) return null;
    return { answer, results };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) {
      _activity.activityMonitor.logComplete(activityId, 0);
    } else {
      _activity.activityMonitor.logError(activityId, message);
    }
    throw err;
  }
}

async function searchWithGeminiWeb(query, options = {}) {
  const cookies = await (0, _geminiWeb.isGeminiWebAvailable)();
  if (!cookies) return null;

  const prompt = buildSearchPrompt(query, options);
  const activityId = _activity.activityMonitor.logStart({ type: "api", query });

  try {
    const text = await (0, _geminiWeb.queryWithCookies)(prompt, cookies, {
      model: "gemini-3-flash-preview",
      signal: options.signal,
      timeoutMs: 60000
    });

    _activity.activityMonitor.logComplete(activityId, 200);

    const results = extractSourceUrls(text);
    return { answer: text, results };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) {
      _activity.activityMonitor.logComplete(activityId, 0);
    } else {
      _activity.activityMonitor.logError(activityId, message);
    }
    throw err;
  }
}

function buildSearchPrompt(query, options) {
  let prompt = `Search the web and answer the following question. Include source URLs for your claims.\nFormat your response as:\n1. A direct answer to the question\n2. Cited sources as markdown links\n\nQuestion: ${query}`;

  if (options.recencyFilter) {
    const labels = {
      day: "past 24 hours",
      week: "past week",
      month: "past month",
      year: "past year"
    };
    prompt += `\n\nOnly include results from the ${labels[options.recencyFilter]}.`;
  }

  if (options.domainFilter?.length) {
    const includes = options.domainFilter.filter((d) => !d.startsWith("-"));
    const excludes = options.domainFilter.filter((d) => d.startsWith("-")).map((d) => d.slice(1));
    if (includes.length) prompt += `\n\nOnly cite sources from: ${includes.join(", ")}`;
    if (excludes.length) prompt += `\n\nDo not cite sources from: ${excludes.join(", ")}`;
  }

  return prompt;
}

function extractSourceUrls(markdown) {
  const results = [];
  const seen = new Set();
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  for (const match of markdown.matchAll(linkRegex)) {
    const url = match[2];
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({ title: match[1], url, snippet: "" });
  }
  return results;
}

async function resolveGroundingChunks(
chunks,
signal)
{
  if (!chunks?.length) return [];

  const results = [];
  for (const chunk of chunks) {
    if (!chunk.web) continue;
    const title = chunk.web.title || "";
    let url = chunk.web.uri || "";

    if (url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
      const resolved = await resolveRedirect(url, signal);
      if (resolved) url = resolved;
    }

    if (url) results.push({ title, url, snippet: "" });
  }
  return results;
}

async function resolveRedirect(proxyUrl, signal) {
  try {
    const res = await fetch(proxyUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.any([
      AbortSignal.timeout(5000),
      ...(signal ? [signal] : [])]
      )
    });
    return res.headers.get("location") || null;
  } catch {
    return null;
  }
} /* v9-e316b01b2036b15f */
