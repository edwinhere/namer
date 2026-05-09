"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.DEFAULT_MODEL = exports.API_BASE = void 0;exports.getApiKey = getApiKey;exports.isGeminiApiAvailable = isGeminiApiAvailable;exports.queryGeminiApiWithVideo = queryGeminiApiWithVideo;var _nodeFs = await jitiImport("node:fs");
var _nodeOs = await jitiImport("node:os");
var _nodePath = await jitiImport("node:path");

const API_BASE = exports.API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const CONFIG_PATH = (0, _nodePath.join)((0, _nodeOs.homedir)(), ".pi", "web-search.json");
const DEFAULT_MODEL = exports.DEFAULT_MODEL = "gemini-3-flash-preview";





let cachedConfig = null;

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (!(0, _nodeFs.existsSync)(CONFIG_PATH)) {
    cachedConfig = {};
    return cachedConfig;
  }

  const raw = (0, _nodeFs.readFileSync)(CONFIG_PATH, "utf-8");
  try {
    cachedConfig = JSON.parse(raw);
    return cachedConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }
}

function withTimeout(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizeApiKey(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getApiKey() {
  return normalizeApiKey(process.env.GEMINI_API_KEY) ?? normalizeApiKey(loadConfig().geminiApiKey);
}

function isGeminiApiAvailable() {
  return getApiKey() !== null;
}








async function queryGeminiApiWithVideo(
prompt,
videoUri,
options = {})
{
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const model = options.model ?? DEFAULT_MODEL;
  const signal = withTimeout(options.signal, options.timeoutMs ?? 120000);
  const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const fileData = { fileUri: videoUri };
  if (options.mimeType) fileData.mimeType = options.mimeType;

  const body = {
    contents: [
    {
      parts: [
      { fileData },
      { text: prompt }]

    }]

  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.
  map((p) => p.text).
  filter(Boolean).
  join("\n");

  if (!text) throw new Error("Gemini API returned empty response");
  return text;
} /* v9-c8e90b8826d73142 */
