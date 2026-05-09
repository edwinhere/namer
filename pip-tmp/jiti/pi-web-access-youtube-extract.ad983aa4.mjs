"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.extractYouTube = extractYouTube;exports.extractYouTubeFrame = extractYouTubeFrame;exports.extractYouTubeFrames = extractYouTubeFrames;exports.fetchYouTubeThumbnail = fetchYouTubeThumbnail;exports.getYouTubeStreamInfo = getYouTubeStreamInfo;exports.isYouTubeEnabled = isYouTubeEnabled;exports.isYouTubeURL = isYouTubeURL;var _nodeChild_process = await jitiImport("node:child_process");
var _nodeFs = await jitiImport("node:fs");
var _nodeOs = await jitiImport("node:os");
var _nodePath = await jitiImport("node:path");
var _activity = await jitiImport("./activity.js");
var _geminiWeb = await jitiImport("./gemini-web.js");
var _geminiApi = await jitiImport("./gemini-api.js");
var _perplexity = await jitiImport("./perplexity.js");
var _extract = await jitiImport("./extract.js");
var _utils = await jitiImport("./utils.js");

const CONFIG_PATH = (0, _nodePath.join)((0, _nodeOs.homedir)(), ".pi", "web-search.json");

const YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const YOUTUBE_REGEX =
/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

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

const defaults = { enabled: true, preferredModel: "gemini-3-flash-preview" };
let cachedConfig = null;

function loadYouTubeConfig() {
  if (cachedConfig) return cachedConfig;
  if (!(0, _nodeFs.existsSync)(CONFIG_PATH)) {
    cachedConfig = { ...defaults };
    return cachedConfig;
  }

  const rawText = (0, _nodeFs.readFileSync)(CONFIG_PATH, "utf-8");
  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }

  const yt = raw.youtube ?? {};
  cachedConfig = {
    enabled: normalizeEnabled(yt.enabled, defaults.enabled),
    preferredModel: normalizePreferredModel(yt.preferredModel, defaults.preferredModel)
  };
  return cachedConfig;
}

function isYouTubeURL(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/playlist") {
      return { isYouTube: false, videoId: null };
    }
  } catch {
  }

  const match = url.match(YOUTUBE_REGEX);
  if (!match) return { isYouTube: false, videoId: null };
  return { isYouTube: true, videoId: match[1] };
}

function isYouTubeEnabled() {
  return loadYouTubeConfig().enabled;
}

async function extractYouTube(
url,
signal,
prompt,
model)
{
  const config = loadYouTubeConfig();
  const { videoId } = isYouTubeURL(url);
  const canonicalUrl = videoId ?
  `https://www.youtube.com/watch?v=${videoId}` :
  url;
  const effectivePrompt = prompt ?? YOUTUBE_PROMPT;
  const effectiveModel = model ?? config.preferredModel;

  const activityId = _activity.activityMonitor.logStart({ type: "fetch", url: `youtube.com/${videoId ?? "video"}` });

  const result = (await tryGeminiWeb(canonicalUrl, effectivePrompt, effectiveModel, signal)) ?? (
  await tryGeminiApi(canonicalUrl, effectivePrompt, effectiveModel, signal)) ?? (
  await tryPerplexity(url, effectivePrompt, signal));

  if (result) {
    result.url = url;
    if (videoId) {
      const thumb = await fetchYouTubeThumbnail(videoId);
      if (thumb) result.thumbnail = thumb;
    }
    _activity.activityMonitor.logComplete(activityId, 200);
    return result;
  }

  if (signal?.aborted) {
    _activity.activityMonitor.logComplete(activityId, 0);
    return null;
  }

  _activity.activityMonitor.logError(activityId, "all extraction paths failed");
  return null;
}




function mapYtDlpError(err) {
  const { code, stderr, message } = (0, _utils.readExecError)(err);
  if (code === "ENOENT") return "yt-dlp is not installed. Install with: brew install yt-dlp";
  if ((0, _utils.isTimeoutError)(err)) return "yt-dlp timed out fetching video info";
  const lower = stderr.toLowerCase();
  if (lower.includes("private")) return "Video is private or unavailable";
  if (lower.includes("sign in")) return "Video is age-restricted and requires authentication";
  if (lower.includes("not available")) return "Video is unavailable in your region or has been removed";
  if (lower.includes("live")) return "Cannot extract frames from a live stream";
  const snippet = (0, _utils.trimErrorText)(stderr || message);
  return snippet ? `yt-dlp failed: ${snippet}` : "yt-dlp failed";
}

async function getYouTubeStreamInfo(videoId) {
  try {
    const output = (0, _nodeChild_process.execFileSync)("yt-dlp", [
    "--print", "duration",
    "-g", `https://www.youtube.com/watch?v=${videoId}`],
    { timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    const lines = output.split(/\r?\n/);
    const rawDuration = lines[0]?.trim();
    const streamUrl = lines[1]?.trim();
    if (!streamUrl) return { error: "yt-dlp failed: missing stream URL" };
    const parsedDuration = rawDuration && rawDuration !== "NA" ? Number.parseFloat(rawDuration) : NaN;
    const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;
    return { streamUrl, duration };
  } catch (err) {
    return { error: mapYtDlpError(err) };
  }
}

async function extractFrameFromStream(streamUrl, seconds) {
  try {
    const buffer = (0, _nodeChild_process.execFileSync)("ffmpeg", [
    "-ss", String(seconds), "-i", streamUrl,
    "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
    { maxBuffer: 5 * 1024 * 1024, timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
    if (buffer.length === 0) return { error: "ffmpeg failed: empty output" };
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch (err) {
    return { error: (0, _utils.mapFfmpegError)(err) };
  }
}

async function extractYouTubeFrame(
videoId,
seconds,
streamInfo)
{
  const info = streamInfo ?? (await getYouTubeStreamInfo(videoId));
  if ("error" in info) return info;
  return extractFrameFromStream(info.streamUrl, seconds);
}

async function extractYouTubeFrames(
videoId,
timestamps,
streamInfo)
{
  const info = streamInfo ?? (await getYouTubeStreamInfo(videoId));
  if ("error" in info) return { frames: [], duration: null, error: info.error };
  const results = await Promise.all(timestamps.map(async (t) => {
    const frame = await extractFrameFromStream(info.streamUrl, t);
    if ("error" in frame) return { error: frame.error };
    return { ...frame, timestamp: (0, _utils.formatSeconds)(t) };
  }));
  const frames = results.filter((f) => "data" in f);
  const errorResult = results.find((f) => "error" in f);
  return { frames, duration: info.duration, error: frames.length === 0 && errorResult ? errorResult.error : null };
}

async function fetchYouTubeThumbnail(videoId) {
  try {
    const res = await fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}

async function tryGeminiWeb(
url,
prompt,
model,
signal)
{
  try {
    const cookies = await (0, _geminiWeb.isGeminiWebAvailable)();
    if (!cookies) return null;

    if (signal?.aborted) return null;

    const text = await (0, _geminiWeb.queryWithCookies)(prompt, cookies, {
      youtubeUrl: url,
      model,
      signal,
      timeoutMs: 120000
    });

    return {
      url,
      title: (0, _extract.extractHeadingTitle)(text) ?? "YouTube Video",
      content: text,
      error: null
    };
  } catch (err) {
    if (shouldRethrow(err)) throw err;
    return null;
  }
}

async function tryGeminiApi(
url,
prompt,
model,
signal)
{
  try {
    if (!(0, _geminiApi.isGeminiApiAvailable)()) return null;

    if (signal?.aborted) return null;

    const text = await (0, _geminiApi.queryGeminiApiWithVideo)(prompt, url, {
      model,
      signal,
      timeoutMs: 120000
    });

    return {
      url,
      title: (0, _extract.extractHeadingTitle)(text) ?? "YouTube Video",
      content: text,
      error: null
    };
  } catch (err) {
    if (shouldRethrow(err)) throw err;
    return null;
  }
}

async function tryPerplexity(
url,
prompt,
signal)
{
  try {
    if (signal?.aborted) return null;

    const perplexityQuery = prompt === YOUTUBE_PROMPT ?
    `Summarize this YouTube video in detail: ${url}` :
    `${prompt} YouTube video: ${url}`;

    const { answer } = await (0, _perplexity.searchWithPerplexity)(
      perplexityQuery,
      { signal }
    );

    if (!answer) return null;

    const content =
    `# Video Summary (via Perplexity)\n\n${answer}\n\n` +
    `*Full video understanding requires Gemini access. Set GEMINI_API_KEY or sign into Google in Chrome.*`;

    return {
      url,
      title: "Video Summary (via Perplexity)",
      content,
      error: null
    };
  } catch (err) {
    if (shouldRethrow(err)) throw err;
    return null;
  }
} /* v9-17a1ab2a3312f92e */
