// Cloudflare Workers 专用情报扫描入口。
// 不加载 .env，不使用 fs/path/child_process，只复用各 source module 的 fetch 逻辑。
// 所有 API key 通过 env 参数传入各 source 的 briefing()，不依赖 process.env。

import { briefing as gdelt } from './sources/gdelt.mjs';
import { briefing as opensky } from './sources/opensky.mjs';
import { briefing as firms } from './sources/firms.mjs';
import { briefing as ships } from './sources/ships.mjs';
import { briefing as safecast } from './sources/safecast.mjs';
import { briefing as acled } from './sources/acled.mjs';
import { briefing as reliefweb } from './sources/reliefweb.mjs';
import { briefing as who } from './sources/who.mjs';
import { briefing as ofac } from './sources/ofac.mjs';
import { briefing as opensanctions } from './sources/opensanctions.mjs';
import { briefing as adsb } from './sources/adsb.mjs';
import { briefing as fred } from './sources/fred.mjs';
import { briefing as treasury } from './sources/treasury.mjs';
import { briefing as bls } from './sources/bls.mjs';
import { briefing as eia } from './sources/eia.mjs';
import { briefing as gscpi } from './sources/gscpi.mjs';
import { briefing as usaspending } from './sources/usaspending.mjs';
import { briefing as comtrade } from './sources/comtrade.mjs';
import { briefing as noaa } from './sources/noaa.mjs';
import { briefing as epa } from './sources/epa.mjs';
import { briefing as patents } from './sources/patents.mjs';
import { briefing as bluesky } from './sources/bluesky.mjs';
import { briefing as telegram } from './sources/telegram.mjs';
import { briefing as kiwisdr } from './sources/kiwisdr.mjs';
import { briefing as space } from './sources/space.mjs';
import { briefing as yfinance } from './sources/yfinance.mjs';
import { briefing as cisaKev } from './sources/cisa-kev.mjs';
import { briefing as cloudflareRadar } from './sources/cloudflare-radar.mjs';
import { getRuntimeConfig } from '../lib/config/runtime-config.mjs';

const SOURCE_TIMEOUT_MS = 25_000;

function boolEnv(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

/**
 * Build the source plan with all API keys injected from env.
 * Sources are classified as:
 *   A. enabled (ok or failed)
 *   B. disabled (no key, or feature flag off, or incompatible with Cloudflare)
 */
export function getCloudflareSourcePlan(env = {}) {
  const config = getRuntimeConfig(env);
  const enableTelegramSource = boolEnv(env.ENABLE_TELEGRAM_SOURCE, true);
  const enableRedditSource = boolEnv(env.ENABLE_REDDIT_SOURCE, false);
  const hasAdsbKey = Boolean(config.ADSB_API_KEY);
  const hasAISKey = Boolean(config.AISSTREAM_API_KEY);
  const enableAISStream = boolEnv(env.ENABLE_AISSTREAM_SOURCE, false) && hasAISKey;

  const sources = [
    // ── Public sources (no key required) ──
    { name: 'GDELT', fn: gdelt, args: [] },
    { name: 'OpenSky', fn: opensky, args: [] },
    { name: 'Safecast', fn: safecast, args: [] },
    { name: 'ReliefWeb', fn: reliefweb, args: [] },
    { name: 'WHO', fn: who, args: [] },
    { name: 'OFAC', fn: ofac, args: [] },
    { name: 'OpenSanctions', fn: opensanctions, args: [] },
    { name: 'Treasury', fn: treasury, args: [] },
    { name: 'GSCPI', fn: gscpi, args: [] },
    { name: 'USAspending', fn: usaspending, args: [] },
    { name: 'Comtrade', fn: comtrade, args: [] },
    { name: 'NOAA', fn: noaa, args: [] },
    { name: 'EPA', fn: epa, args: [] },
    { name: 'Patents', fn: patents, args: [] },
    { name: 'Bluesky', fn: bluesky, args: [] },
    { name: 'KiwiSDR', fn: kiwisdr, args: [] },
    { name: 'Space', fn: space, args: [] },
    { name: 'YFinance', fn: yfinance, args: [] },
    { name: 'CISA-KEV', fn: cisaKev, args: [] },

    // ── Keyed sources (pass keys as args) ──
    { name: 'FIRMS', fn: firms, args: [config.FIRMS_MAP_KEY] },
    { name: 'FRED', fn: fred, args: [config.FRED_API_KEY] },
    { name: 'BLS', fn: bls, args: [config.BLS_API_KEY] },
    { name: 'EIA', fn: eia, args: [config.EIA_API_KEY] },
    { name: 'ACLED', fn: acled, args: [config.ACLED_EMAIL, config.ACLED_PASSWORD] },
    { name: 'Cloudflare-Radar', fn: cloudflareRadar, args: [config.CLOUDFLARE_API_TOKEN] },
    { name: 'Telegram', fn: telegram, args: [config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHANNELS], enabled: enableTelegramSource },

    // ── Conditionally disabled sources ──
    {
      name: 'ADS-B',
      fn: adsb,
      args: [config.ADSB_API_KEY],
      enabled: hasAdsbKey,
      disabledReason: hasAdsbKey ? undefined : 'ADSB_API_KEY 未配置；ADS-B 为可选付费源，已自动禁用',
    },
    {
      // Maritime chokepoint data is static (no WebSocket), always runs
      name: 'Maritime',
      fn: ships,
      args: [config.AISSTREAM_API_KEY],
      enabled: true,
    },
    {
      name: 'Reddit',
      fn: null,
      enabled: enableRedditSource,
      disabledReason: enableRedditSource ? undefined : 'ENABLE_REDDIT_SOURCE=false；Reddit OAuth 源已禁用',
    },
  ];

  return sources.map(source => {
    // Reddit with no fn → always disabled
    if (source.name === 'Reddit' && !source.fn) {
      return { ...source, enabled: false, args: [] };
    }
    return { enabled: source.enabled !== false, args: source.args || [], ...source };
  });
}

export async function runCloudflareSource(name, fn, args = []) {
  const start = Date.now();
  let timer;
  try {
    if (typeof fn !== 'function') {
      throw new Error('Source disabled or unavailable in Cloudflare runtime');
    }
    const dataPromise = fn(...args);
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Source ${name} timed out after ${SOURCE_TIMEOUT_MS / 1000}s`)), SOURCE_TIMEOUT_MS);
    });
    const data = await Promise.race([dataPromise, timeoutPromise]);
    return { name, status: 'ok', durationMs: Date.now() - start, data };
  } catch (err) {
    return { name, status: 'error', durationMs: Date.now() - start, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fullBriefingCloudflare(env = {}) {
  const start = Date.now();
  const plan = getCloudflareSourcePlan(env);
  const enabled = plan.filter(source => source.enabled);
  const disabled = plan.filter(source => !source.enabled);

  const results = await Promise.allSettled(
    enabled.map(source => runCloudflareSource(source.name, source.fn, source.args || []))
  );

  const sources = results.map(result => (
    result.status === 'fulfilled'
      ? result.value
      : { status: 'failed', error: result.reason?.message || 'Unknown source failure' }
  ));

  // Build per-source status (A=ok, B=disabled, C=failed)
  const sourceStatus = {};
  for (const s of sources) {
    const isOk = s.status === 'ok' && !s.data?.error && !s.data?.status?.includes?.('no_');
    sourceStatus[s.name] = {
      enabled: true,
      ok: isOk,
      count: isOk ? estimateCount(s.data) : 0,
      cached: false,
      error: isOk ? null : (s.error || s.data?.error || s.data?.message || null),
      durationMs: s.durationMs || 0,
    };
  }
  for (const d of disabled) {
    sourceStatus[d.name] = {
      enabled: false,
      ok: null,
      count: 0,
      cached: false,
      error: d.disabledReason || 'disabled by config',
    };
  }

  const okSources = sources.filter(s => sourceStatus[s.name]?.ok);
  const failedSources = sources.filter(s => sourceStatus[s.name]?.ok === false);

  const output = {
    crucix: {
      version: '2.0.0-cloudflare',
      runtime: 'cloudflare',
      timestamp: new Date().toISOString(),
      totalDurationMs: Date.now() - start,
      sourcesQueried: enabled.length,
      sourcesOk: okSources.length,
      sourcesFailed: failedSources.length,
      sourcesDisabled: disabled.length,
    },
    sources: Object.fromEntries(sources.filter(s => s.status === 'ok').map(s => [s.name, s.data])),
    errors: failedSources.map(s => ({ name: s.name, error: sanitizeError(s.error || sourceStatus[s.name]?.error) })),
    disabledSources: disabled.map(s => ({ name: s.name, reason: s.disabledReason || 'disabled by config' })),
    timing: Object.fromEntries(sources.map(s => [s.name, { status: s.status, ms: s.durationMs }])),
    sourceStatus,
  };

  return output;
}

/**
 * Estimate the "count" of items in a source result for status display.
 */
function estimateCount(data) {
  if (!data || typeof data !== 'object') return 0;
  // Check for common patterns
  if (Array.isArray(data)) return data.length;
  if (data.totalEvents) return data.totalEvents;
  if (data.totalArticles) return data.totalArticles;
  if (data.totalDetections) return data.totalDetections;
  if (data.hotspots && Array.isArray(data.hotspots)) {
    return data.hotspots.reduce((sum, h) => sum + (h.totalDetections || 0), 0);
  }
  if (data.indicators && Array.isArray(data.indicators)) return data.indicators.length;
  if (data.quotes && typeof data.quotes === 'object') return Object.keys(data.quotes).length;
  return 1; // Source returned something
}

/**
 * Remove API keys from error messages for safe display.
 */
function sanitizeError(error) {
  if (!error) return null;
  const str = String(error);
  // Mask anything that looks like an API key (long alphanumeric strings)
  return str.replace(/[A-Za-z0-9_-]{20,}/g, '●●●●');
}
