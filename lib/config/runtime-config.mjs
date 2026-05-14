// Unified runtime config reader for Cloudflare Workers and Node.js.
// Cloudflare Workers receive secrets via `env` parameter.
// Node.js reads from `process.env`.
// This module MUST NOT read process.env at module scope.

/**
 * Parse boolean-ish environment values.
 * Supports: 'true', '1', 'yes', 'on' → true
 *           'false', '0', 'no', 'off', '' → false
 */
export function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

/**
 * Build a unified config object from Cloudflare Worker env bindings.
 * Call this at the START of every request/cron handler, passing the Worker `env`.
 * For Node.js local mode, pass `process.env` or `{}`.
 *
 * @param {object} env - Cloudflare Worker env or process.env
 * @returns {object} Resolved config with all keys
 */
export function getRuntimeConfig(env = {}) {
  const pe = (typeof globalThis.process !== 'undefined' && globalThis.process.env) || {};
  const get = (key) => {
    const v = env[key] ?? pe[key];
    return (v === undefined || v === null) ? undefined : String(v);
  };
  const getBool = (key, fallback) => boolEnv(env[key] ?? pe[key], fallback);

  return {
    // ── API Keys / Secrets ──
    FRED_API_KEY: get('FRED_API_KEY'),
    FIRMS_MAP_KEY: get('FIRMS_MAP_KEY'),
    EIA_API_KEY: get('EIA_API_KEY'),
    BLS_API_KEY: get('BLS_API_KEY'),
    ACLED_EMAIL: get('ACLED_EMAIL'),
    ACLED_PASSWORD: get('ACLED_PASSWORD'),
    AISSTREAM_API_KEY: get('AISSTREAM_API_KEY'),
    ADSB_API_KEY: get('ADSB_API_KEY'),
    CLOUDFLARE_API_TOKEN: get('CLOUDFLARE_API_TOKEN'),
    ADMIN_TOKEN: get('ADMIN_TOKEN'),
    LLM_API_KEY: get('LLM_API_KEY'),
    LLM_PROVIDER: get('LLM_PROVIDER'),
    LLM_MODEL: get('LLM_MODEL'),
    LLM_BASE_URL: get('LLM_BASE_URL'),
    TELEGRAM_BOT_TOKEN: get('TELEGRAM_BOT_TOKEN'),
    TELEGRAM_CHAT_ID: get('TELEGRAM_CHAT_ID'),
    TELEGRAM_CHANNELS: get('TELEGRAM_CHANNELS'),
    DISCORD_BOT_TOKEN: get('DISCORD_BOT_TOKEN'),
    DISCORD_WEBHOOK_URL: get('DISCORD_WEBHOOK_URL'),
    DISCORD_CHANNEL_ID: get('DISCORD_CHANNEL_ID'),
    DISCORD_GUILD_ID: get('DISCORD_GUILD_ID'),
    REDDIT_CLIENT_ID: get('REDDIT_CLIENT_ID'),
    REDDIT_CLIENT_SECRET: get('REDDIT_CLIENT_SECRET'),
    RELIEFWEB_APPNAME: get('RELIEFWEB_APPNAME'),

    // ── Customization ──
    FRED_SERIES_IDS: get('FRED_SERIES_IDS'),
    YFINANCE_SYMBOLS: get('YFINANCE_SYMBOLS'),
    OPENSKY_HOTSPOTS: get('OPENSKY_HOTSPOTS'),

    // ── Feature flags ──
    ENABLE_LLM: getBool('ENABLE_LLM', false),
    ENABLE_TELEGRAM: getBool('ENABLE_TELEGRAM', false),       // Bot notifications only
    ENABLE_TELEGRAM_SOURCE: getBool('ENABLE_TELEGRAM_SOURCE', true), // Intelligence feed
    ENABLE_DISCORD: getBool('ENABLE_DISCORD', false),
    ENABLE_REDDIT_SOURCE: getBool('ENABLE_REDDIT_SOURCE', false),
    ENABLE_AISSTREAM_SOURCE: getBool('ENABLE_AISSTREAM_SOURCE', false),

    // ── Display / locale ──
    LANGUAGE: get('LANGUAGE') || 'zh-CN',
    PUBLIC_APP_NAME: get('PUBLIC_APP_NAME'),
    REFRESH_INTERVAL_MINUTES: get('REFRESH_INTERVAL_MINUTES') || '15',
    PUBLIC_POLLING_INTERVAL_SECONDS: get('PUBLIC_POLLING_INTERVAL_SECONDS') || '15',

    // ── Runtime detection ──
    isCloudflare: Boolean(
      env.CRUCIX_KV ||
      env.ASSETS ||
      (typeof globalThis.WebSocketPair !== 'undefined') ||
      globalThis.navigator?.userAgent === 'Cloudflare-Workers' ||
      globalThis.__CRUCIX_RUNTIME__ === 'cloudflare'
    ),
  };
}

/**
 * Mask secret values for safe logging/display.
 * Returns '●●●●' + last 4 chars, or 'not-set'.
 */
export function maskSecret(value) {
  if (!value) return 'not-set';
  const s = String(value);
  if (s.length <= 4) return '●●●●';
  return '●●●●' + s.slice(-4);
}
