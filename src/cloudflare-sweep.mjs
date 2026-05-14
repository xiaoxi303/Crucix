import { fullBriefingCloudflare, getCloudflareSourcePlan } from '../apis/briefing-cloudflare.mjs';
import { synthesize, normalizeDashboardPayload } from '../dashboard/synthesize-core.mjs';
import { createStorage, STORAGE_KEYS } from '../lib/storage/index.mjs';
import { StorageMemoryManager } from '../lib/storage/memory.mjs';
import { generateLLMIdeas } from '../lib/llm/ideas.mjs';
import { createCloudflareLLMProvider } from './cloudflare-llm.mjs';
import { getRuntimeConfig } from '../lib/config/runtime-config.mjs';

const ENV_KEYS = [
  'FRED_API_KEY',
  'FIRMS_MAP_KEY',
  'EIA_API_KEY',
  'BLS_API_KEY',
  'AISSTREAM_API_KEY',
  'ACLED_EMAIL',
  'ACLED_PASSWORD',
  'CLOUDFLARE_API_TOKEN',
  'LLM_API_KEY',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_CHANNELS',
  'DISCORD_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_CHANNEL_ID',
  'DISCORD_GUILD_ID',
  'ADMIN_TOKEN',
  'ENABLE_LLM',
  'ENABLE_TELEGRAM',
  'ENABLE_DISCORD',
  'ENABLE_TELEGRAM_SOURCE',
  'ENABLE_REDDIT_SOURCE',
  'ENABLE_AISSTREAM_SOURCE',
  'LANGUAGE',
  'CRUCIX_LANG',
  'REFRESH_INTERVAL_MINUTES',
  'PUBLIC_APP_NAME',
  'PUBLIC_POLLING_INTERVAL_SECONDS',
  'CRUCIX_RUNTIME',
  'FRED_SERIES_IDS',
  'YFINANCE_SYMBOLS',
  'OPENSKY_HOTSPOTS',
  'RELIEFWEB_APPNAME',
  'ADSB_API_KEY',
  'RAPIDAPI_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
];

export function ensureProcessEnv(env = {}) {
  if (!globalThis.process) {
    globalThis.process = { env: {}, argv: [] };
  }
  if (!globalThis.process.env) globalThis.process.env = {};
  if (!Array.isArray(globalThis.process.argv)) globalThis.process.argv = [];
  globalThis.__CRUCIX_RUNTIME__ = 'cloudflare';
  globalThis.process.env.CRUCIX_RUNTIME = 'cloudflare';

  for (const key of ENV_KEYS) {
    if (env[key] !== undefined && env[key] !== null) {
      globalThis.process.env[key] = String(env[key]);
    }
  }
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

function enabledFeatureStatus(env = {}) {
  return {
    llm: boolEnv(env.ENABLE_LLM, false) && Boolean(env.LLM_API_KEY && env.LLM_PROVIDER),
    telegram: boolEnv(env.ENABLE_TELEGRAM, false) && Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    discord: boolEnv(env.ENABLE_DISCORD, false) && Boolean(env.DISCORD_WEBHOOK_URL || env.DISCORD_BOT_TOKEN),
  };
}

export function getEnabledSources(env = {}) {
  const plan = getCloudflareSourcePlan(env);
  return {
    enabled: plan.filter(source => source.enabled).map(source => source.name),
    disabled: plan.filter(source => !source.enabled).map(source => ({
      name: source.name,
      reason: source.disabledReason || 'disabled by config',
    })),
  };
}

/**
 * Try to load cached source data for failed sources.
 */
async function loadCachedSources(storage, failedNames) {
  const cached = {};
  for (const name of failedNames) {
    try {
      const data = await storage.getJSON(STORAGE_KEYS.sourceLastGood(name), null);
      if (data) {
        cached[name] = data;
      }
    } catch {
      // Ignore cache read failures
    }
  }
  return cached;
}

/**
 * Save successful source data to KV cache for future fallback.
 */
async function saveCachedSources(storage, rawData) {
  const sources = rawData?.sources || {};
  const promises = [];
  for (const [name, data] of Object.entries(sources)) {
    if (data && !data.error) {
      promises.push(
        storage.putJSON(STORAGE_KEYS.sourceLastGood(name), data).catch(() => {})
      );
    }
  }
  // Fire and forget — don't block sweep
  await Promise.allSettled(promises);
}

export async function runSweepCycleCloudflare(env = {}, ctx = null, options = {}) {
  ensureProcessEnv(env);
  const storage = await createStorage({ env });
  const startedAt = new Date().toISOString();
  const trigger = options.trigger || 'scheduled';

  await storage.putJSON(STORAGE_KEYS.metaHealth, {
    status: 'running',
    trigger,
    runtime: 'cloudflare',
    startedAt,
    updatedAt: startedAt,
    features: enabledFeatureStatus(env),
  });

  try {
    const rawData = await fullBriefingCloudflare(env);

    // ── Per-source KV caching ──
    // Save successful sources for future fallback
    await saveCachedSources(storage, rawData);

    // Load cached data for failed sources
    const failedNames = (rawData.errors || []).map(e => e.name);
    if (failedNames.length > 0) {
      const cachedSources = await loadCachedSources(storage, failedNames);
      for (const [name, cachedData] of Object.entries(cachedSources)) {
        rawData.sources[name] = cachedData;
        // Mark as cached in sourceStatus
        if (rawData.sourceStatus?.[name]) {
          rawData.sourceStatus[name].cached = true;
          rawData.sourceStatus[name].ok = true;
          rawData.sourceStatus[name].error = null;
        }
      }
      // Update counts
      const cachedCount = Object.keys(cachedSources).length;
      if (rawData.crucix) {
        rawData.crucix.sourcesOk += cachedCount;
        rawData.crucix.sourcesFailed -= cachedCount;
      }
    }

    const synthesized = await synthesize(rawData);
    const memory = await StorageMemoryManager.create(storage);
    const delta = await memory.addRun(synthesized);
    synthesized.delta = delta;

    const llmProvider = await createCloudflareLLMProvider(env);
    if (llmProvider?.isConfigured) {
      try {
        const previousIdeas = memory.getLastRun()?.ideas || [];
        const llmIdeas = await generateLLMIdeas(llmProvider, synthesized, delta, previousIdeas);
        synthesized.ideas = Array.isArray(llmIdeas) ? llmIdeas : [];
        synthesized.ideasSource = synthesized.ideas.length ? 'llm' : 'llm-failed';
      } catch (err) {
        console.warn(`[Cloudflare Sweep] LLM 生成失败: ${err.message}`);
        synthesized.ideas = [];
        synthesized.ideasSource = 'llm-failed';
      }
    } else {
      synthesized.ideas = [];
      synthesized.ideasSource = 'disabled';
    }

    await memory.pruneAlertedSignals();

    // ── Normalize payload before writing ──
    const normalized = normalizeDashboardPayload(synthesized);

    const finishedAt = new Date().toISOString();
    const latestWrite = await storage.putJSON(STORAGE_KEYS.latest, normalized);
    const lastSweep = {
      status: latestWrite.ok ? 'success' : 'partial',
      trigger,
      startedAt,
      finishedAt,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      sourcesOk: normalized.meta?.sourcesOk || 0,
      sourcesQueried: normalized.meta?.sourcesQueried || 0,
      sourcesFailed: normalized.meta?.sourcesFailed || 0,
      sourceErrors: (rawData.errors || []).map(e => ({ name: e.name, error: e.error })),
      latestWrite,
    };

    await storage.putJSON(STORAGE_KEYS.metaLastSweep, lastSweep);
    await storage.putJSON(STORAGE_KEYS.metaLastSuccessfulSweep, lastSweep);
    await storage.putJSON(STORAGE_KEYS.metaHealth, {
      status: latestWrite.ok ? 'ok' : 'degraded',
      runtime: 'cloudflare',
      updatedAt: finishedAt,
      lastSweep,
      features: enabledFeatureStatus(env),
      storage: await storage.healthCheck(),
    });

    return { ok: latestWrite.ok, data: normalized, lastSweep };
  } catch (err) {
    const failedAt = new Date().toISOString();
    const health = {
      status: 'error',
      runtime: 'cloudflare',
      trigger,
      startedAt,
      failedAt,
      error: err.message,
      stack: undefined,
      features: enabledFeatureStatus(env),
      storage: await storage.healthCheck(),
    };
    await storage.putJSON(STORAGE_KEYS.metaHealth, health);
    await storage.putJSON(STORAGE_KEYS.metaLastSweep, health);
    await storage.putJSON(STORAGE_KEYS.metaLastFailedSweep, health);
    console.error('[Cloudflare Sweep] 情报扫描失败:', err);
    return { ok: false, error: err.message };
  }
}
