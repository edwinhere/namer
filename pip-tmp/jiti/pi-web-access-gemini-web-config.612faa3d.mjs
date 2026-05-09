"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.getChromeProfileFromConfig = getChromeProfileFromConfig;exports.isBrowserCookieAccessAllowed = isBrowserCookieAccessAllowed;exports.normalizeChromeProfile = normalizeChromeProfile;var _nodeFs = await jitiImport("node:fs");
var _nodeOs = await jitiImport("node:os");
var _nodePath = await jitiImport("node:path");

const CONFIG_PATH = (0, _nodePath.join)((0, _nodeOs.homedir)(), ".pi", "web-search.json");






let cachedConfig = null;

function normalizeChromeProfile(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (!(0, _nodeFs.existsSync)(CONFIG_PATH)) {
    cachedConfig = {};
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

  cachedConfig = {
    chromeProfile: normalizeChromeProfile(raw.chromeProfile),
    allowBrowserCookies: raw.allowBrowserCookies === true
  };
  return cachedConfig;
}

function getChromeProfileFromConfig() {
  return loadConfig().chromeProfile;
}

function isBrowserCookieAccessAllowed() {
  if (process.env.PI_ALLOW_BROWSER_COOKIES === "1" || process.env.FEYNMAN_ALLOW_BROWSER_COOKIES === "1") {
    return true;
  }
  return loadConfig().allowBrowserCookies === true;
} /* v9-3c5f441b5ffff223 */
