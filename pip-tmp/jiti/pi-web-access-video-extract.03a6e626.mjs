"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.extractVideo = extractVideo;exports.extractVideoFrame = extractVideoFrame;exports.getLocalVideoDuration = getLocalVideoDuration;exports.isVideoFile = isVideoFile;var _nodeChild_process = await jitiImport("node:child_process");
var _nodeFs = await jitiImport("node:fs");
var _promises = await jitiImport("node:fs/promises");
var _nodePath = await jitiImport("node:path");
var _nodeOs = await jitiImport("node:os");
var _activity = await jitiImport("./activity.js");
var _geminiWeb = await jitiImport("./gemini-web.js");
var _geminiApi = await jitiImport("./gemini-api.js");
var _extract = await jitiImport("./extract.js");
var _utils = await jitiImport("./utils.js");

const CONFIG_PATH = (0, _nodePath.join)((0, _nodeOs.homedir)(), ".pi", "web-search.json");
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

const DEFAULT_VIDEO_PROMPT = `Extract the complete content of this video. Include:
1. Video title (infer from content if not explicit), duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const VIDEO_EXTENSIONS = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp"
};

function shouldRethrow(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.startsWith("Failed to parse ");
}













function normalizePreferredModel(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeEnabled(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMaxSizeMB(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value > 0 ? value : fallback;
}

const VIDEO_CONFIG_DEFAULTS = {
  enabled: true,
  preferredModel: "gemini-3-flash-preview",
  maxSizeMB: 50
};

let cachedVideoConfig = null;

function loadVideoConfig() {
  if (cachedVideoConfig) return cachedVideoConfig;
  if (!(0, _nodeFs.existsSync)(CONFIG_PATH)) {
    cachedVideoConfig = { ...VIDEO_CONFIG_DEFAULTS };
    return cachedVideoConfig;
  }

  const rawText = (0, _nodeFs.readFileSync)(CONFIG_PATH, "utf-8");
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }

  const v = raw.video ?? {};
  cachedVideoConfig = {
    enabled: normalizeEnabled(v.enabled, VIDEO_CONFIG_DEFAULTS.enabled),
    preferredModel: normalizePreferredModel(v.preferredModel, VIDEO_CONFIG_DEFAULTS.preferredModel),
    maxSizeMB: normalizeMaxSizeMB(v.maxSizeMB, VIDEO_CONFIG_DEFAULTS.maxSizeMB)
  };
  return cachedVideoConfig;
}

function isVideoFile(input) {
  const config = loadVideoConfig();
  if (!config.enabled) return null;

  const isFilePath = input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("file://");
  if (!isFilePath) return null;

  let filePath = input;
  if (input.startsWith("file://")) {
    try {
      filePath = decodeURIComponent(new URL(input).pathname);
    } catch {
      return null;
    }
  }

  const ext = (0, _nodePath.extname)(filePath).toLowerCase();
  const mimeType = VIDEO_EXTENSIONS[ext];
  if (!mimeType) return null;

  const absolutePath = resolveFilePath(filePath);
  if (!absolutePath) return null;

  let stat;
  try {
    stat = (0, _nodeFs.statSync)(absolutePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const maxBytes = config.maxSizeMB * 1024 * 1024;
  if (stat.size > maxBytes) return null;

  return { absolutePath, mimeType, sizeBytes: stat.size };
}

function resolveFilePath(filePath) {
  const absolutePath = (0, _nodePath.resolve)(filePath);
  if ((0, _nodeFs.existsSync)(absolutePath)) return absolutePath;

  const dir = (0, _nodePath.dirname)(absolutePath);
  const base = (0, _nodePath.basename)(absolutePath);
  if (!(0, _nodeFs.existsSync)(dir)) return null;

  try {
    const normalizedBase = normalizeSpaces(base);
    const match = (0, _nodeFs.readdirSync)(dir).find((f) => normalizeSpaces(f) === normalizedBase);
    return match ? (0, _nodePath.join)(dir, match) : null;
  } catch {
    return null;
  }
}

function normalizeSpaces(s) {
  return s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ");
}

async function extractVideo(
info,
signal,
options)
{
  const config = loadVideoConfig();
  const effectivePrompt = options?.prompt ?? DEFAULT_VIDEO_PROMPT;
  const effectiveModel = options?.model ?? config.preferredModel;
  const displayName = (0, _nodePath.basename)(info.absolutePath);
  const activityId = _activity.activityMonitor.logStart({ type: "fetch", url: `video:${displayName}` });

  const result = (await tryVideoGeminiApi(info, effectivePrompt, effectiveModel, signal)) ?? (
  await tryVideoGeminiWeb(info, effectivePrompt, effectiveModel, signal));

  if (result) {
    const thumbnail = await extractVideoFrame(info.absolutePath);
    if (!("error" in thumbnail)) {
      result.thumbnail = thumbnail;
    }
    _activity.activityMonitor.logComplete(activityId, 200);
    return result;
  }

  if (signal?.aborted) {
    _activity.activityMonitor.logComplete(activityId, 0);
    return null;
  }

  _activity.activityMonitor.logError(activityId, "all video extraction paths failed");
  return null;
}

function mapFfprobeError(err) {
  const { code, stderr, message } = (0, _utils.readExecError)(err);
  if (code === "ENOENT") return "ffprobe is not installed. Install ffmpeg which includes ffprobe";
  const snippet = (0, _utils.trimErrorText)(stderr || message);
  return snippet ? `ffprobe failed: ${snippet}` : "ffprobe failed";
}

async function extractVideoFrame(filePath, seconds = 1) {
  try {
    const buffer = (0, _nodeChild_process.execFileSync)("ffmpeg", [
    "-ss", String(seconds), "-i", filePath,
    "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
    { maxBuffer: 5 * 1024 * 1024, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    if (buffer.length === 0) return { error: "ffmpeg failed: empty output" };
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch (err) {
    return { error: (0, _utils.mapFfmpegError)(err) };
  }
}

async function getLocalVideoDuration(filePath) {
  try {
    const output = (0, _nodeChild_process.execFileSync)("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath],
    { timeout: 10000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const duration = Number.parseFloat(output);
    if (!Number.isFinite(duration)) return { error: "ffprobe failed: invalid duration output" };
    return duration;
  } catch (err) {
    return { error: mapFfprobeError(err) };
  }
}

async function tryVideoGeminiWeb(
info,
prompt,
model,
signal)
{
  try {
    const cookies = await (0, _geminiWeb.isGeminiWebAvailable)();
    if (!cookies) return null;
    if (signal?.aborted) return null;

    const text = await (0, _geminiWeb.queryWithCookies)(prompt, cookies, {
      files: [info.absolutePath],
      model,
      signal,
      timeoutMs: 180000
    });

    return {
      url: info.absolutePath,
      title: extractVideoTitle(text, info.absolutePath),
      content: text,
      error: null
    };
  } catch (err) {
    if (shouldRethrow(err)) throw err;
    return null;
  }
}

async function tryVideoGeminiApi(
info,
prompt,
model,
signal)
{
  const apiKey = (0, _geminiApi.getApiKey)();
  if (!apiKey) return null;
  if (signal?.aborted) return null;

  let fileName = null;
  try {
    const uploaded = await uploadToFilesApi(info, apiKey, signal);
    fileName = uploaded.name;

    await pollFileState(fileName, apiKey, signal, 120000);

    const text = await (0, _geminiApi.queryGeminiApiWithVideo)(prompt, uploaded.uri, {
      model,
      mimeType: info.mimeType,
      signal,
      timeoutMs: 120000
    });

    return {
      url: info.absolutePath,
      title: extractVideoTitle(text, info.absolutePath),
      content: text,
      error: null
    };
  } catch (err) {
    if (shouldRethrow(err)) throw err;
    return null;
  } finally {
    if (fileName) deleteGeminiFile(fileName, apiKey);
  }
}

async function uploadToFilesApi(
info,
apiKey,
signal)
{
  const displayName = (0, _nodePath.basename)(info.absolutePath);

  const initRes = await fetch(`${UPLOAD_BASE}/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(info.sizeBytes),
      "X-Goog-Upload-Header-Content-Type": info.mimeType,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
    signal
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`File upload init failed: ${initRes.status} (${text.slice(0, 200)})`);
  }

  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("No upload URL in response headers");

  const fileData = await (0, _promises.readFile)(info.absolutePath);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(info.sizeBytes),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: fileData,
    signal
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`File upload failed: ${uploadRes.status} (${text.slice(0, 200)})`);
  }

  const result = await uploadRes.json();
  return result.file;
}

async function pollFileState(
fileName,
apiKey,
signal,
timeoutMs = 120000)
{
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Aborted");

    const res = await fetch(`${_geminiApi.API_BASE}/${fileName}?key=${apiKey}`, { signal });
    if (!res.ok) throw new Error(`File state check failed: ${res.status}`);

    const data = await res.json();
    if (data.state === "ACTIVE") return;
    if (data.state === "FAILED") throw new Error("File processing failed");

    await new Promise((r) => setTimeout(r, 5000));
  }

  throw new Error("File processing timed out");
}

function deleteGeminiFile(fileName, apiKey) {
  fetch(`${_geminiApi.API_BASE}/${fileName}?key=${apiKey}`, { method: "DELETE" }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete Gemini file ${fileName}: ${message}`);
  });
}

function extractVideoTitle(text, filePath) {
  return (0, _extract.extractHeadingTitle)(text) ?? (0, _nodePath.basename)(filePath, (0, _nodePath.extname)(filePath));
} /* v9-89092a226f128a5f */
