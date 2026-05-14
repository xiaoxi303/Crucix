import { createStorage, STORAGE_KEYS } from '../lib/storage/index.mjs';
import { getEnabledSources, runSweepCycleCloudflare } from './cloudflare-sweep.mjs';
import { DEFAULT_LOCALE, getRuntimeLocale, getSupportedLocaleInfo, normalizeLanguage } from './runtime-i18n.mjs';
import { normalizeDashboardPayload, createEmptyPayload } from '../dashboard/synthesize-core.mjs';

const startedAt = Date.now();
const SWEEP_RUNNING_TTL_MS = 10 * 60 * 1000;
const SWEEP_RETRY_TTL_MS = 90 * 1000;

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

function getLanguageFromRequest(url, env) {
  const requested = url.searchParams.get('lang');
  return normalizeLanguage(requested || env.LANGUAGE || env.CRUCIX_LANG || DEFAULT_LOCALE);
}

function publicConfig(env, language) {
  return {
    runtime: 'cloudflare',
    appName: env.PUBLIC_APP_NAME || 'Crucix 中文版',
    language,
    refreshIntervalMinutes: Number.parseInt(env.REFRESH_INTERVAL_MINUTES || '15', 10) || 15,
    pollingIntervalSeconds: Number.parseInt(env.PUBLIC_POLLING_INTERVAL_SECONDS || '15', 10) || 15,
    features: {
      llm: boolEnv(env.ENABLE_LLM, false),
      telegram: boolEnv(env.ENABLE_TELEGRAM, false),
      discord: boolEnv(env.ENABLE_DISCORD, false),
    },
  };
}

function secretEnabled(env, key) {
  return Boolean(env[key]);
}

function getAuthToken(request) {
  const url = new URL(request.url);
  const auth = request.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return request.headers.get('x-admin-token') || url.searchParams.get('token') || '';
}

function isLocalRequest(request) {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
}

function canTriggerSweep(request, env) {
  if (env.ADMIN_TOKEN) return getAuthToken(request) === env.ADMIN_TOKEN;
  return isLocalRequest(request);
}

function isAdminAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return isLocalRequest(request);
  return getAuthToken(request) === env.ADMIN_TOKEN;
}

async function readLatest(storage) {
  return storage.getJSON(STORAGE_KEYS.latest, null);
}

function timestampMs(...values) {
  for (const value of values) {
    if (!value) continue;
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

function isRecent(ms, ttl) {
  return ms && Date.now() - ms < ttl;
}

async function queueSweepIfNeeded(env, ctx, storage, latest, trigger = 'bootstrap') {
  if (latest?.meta || !env.CRUCIX_KV) return { queued: false, reason: latest?.meta ? 'data-exists' : 'kv-missing' };

  const health = await storage.getJSON(STORAGE_KEYS.metaHealth, null);
  const stateTime = timestampMs(
    health?.startedAt,
    health?.updatedAt,
    health?.failedAt,
    health?.lastSweep?.startedAt,
    health?.lastSweep?.finishedAt,
  );

  if (['running', 'queued'].includes(health?.status) && isRecent(stateTime, SWEEP_RUNNING_TTL_MS)) {
    return { queued: false, reason: 'already-running' };
  }
  if (health?.status === 'error' && isRecent(stateTime, SWEEP_RETRY_TTL_MS)) {
    return { queued: false, reason: 'recent-error' };
  }

  const now = new Date().toISOString();
  await storage.putJSON(STORAGE_KEYS.metaHealth, {
    status: 'queued',
    trigger,
    runtime: 'cloudflare',
    startedAt: now,
    updatedAt: now,
    message: '首次访问触发情报扫描，正在后台生成 dashboard 数据。',
  });
  ctx.waitUntil(runSweepCycleCloudflare(env, ctx, { trigger }));
  return { queued: true, trigger };
}

async function serveAsset(request, env, assetPath, injection = '') {
  if (!env.ASSETS) {
    return new Response('ASSETS binding missing', { status: 500 });
  }

  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;
  assetUrl.search = '';
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  const contentType = assetResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetResponse;

  let html = await assetResponse.text();
  if (injection) html = html.replace('</head>', `${injection}\n</head>`);
  html = html.replace('<html lang="en">', '<html lang="zh-CN">');

  const headers = new Headers(assetResponse.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: assetResponse.status, headers });
}

function htmlInjection(env, language) {
  const locale = getRuntimeLocale(language);
  const config = publicConfig(env, language);
  const safeJson = value => JSON.stringify(value).replace(/<\/script>/gi, '<\\/script>');
  return `<script>
window.__CRUCIX_RUNTIME__ = "cloudflare";
window.__CRUCIX_LANGUAGE__ = ${safeJson(language)};
window.__CRUCIX_CONFIG__ = ${safeJson(config)};
window.__CRUCIX_LOCALE__ = ${safeJson(locale)};
</script>`;
}

async function handleHealth(env) {
  const storage = await createStorage({ env });
  const [storageHealth, latest, health, lastSweep] = await Promise.all([
    storage.healthCheck(),
    readLatest(storage),
    storage.getJSON(STORAGE_KEYS.metaHealth, null),
    storage.getJSON(STORAGE_KEYS.metaLastSweep, null),
  ]);
  const language = normalizeLanguage(env.LANGUAGE || env.CRUCIX_LANG || DEFAULT_LOCALE);
  const sourcePlan = getEnabledSources(env);

  // Extract per-source status from latest data
  const sourceStatus = latest?.sourceStatus || {};
  const sourceErrors = (lastSweep?.sourceErrors || []).filter(e => {
    // Don't count disabled sources as errors
    const status = sourceStatus[e.name];
    return status?.enabled !== false;
  });

  return json({
    status: health?.status || (latest ? 'ok' : 'warming'),
    runtime: 'cloudflare',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    lastSweep: lastSweep || health?.lastSweep || null,
    sweepStartedAt: health?.startedAt || health?.lastSweep?.startedAt || lastSweep?.startedAt || null,
    lastError: health?.error || lastSweep?.error || null,
    kv: {
      bound: Boolean(env.CRUCIX_KV),
      ok: Boolean(storageHealth.ok),
      type: storageHealth.type,
      error: storageHealth.ok ? undefined : storageHealth.error,
    },
    dataAvailable: Boolean(latest?.meta),
    language,
    refreshIntervalMinutes: Number.parseInt(env.REFRESH_INTERVAL_MINUTES || '15', 10) || 15,
    sources: sourcePlan,
    sourceStatus,
    sourceErrors,
    features: {
      llm: { enabled: boolEnv(env.ENABLE_LLM, false), configured: secretEnabled(env, 'LLM_API_KEY') },
      telegram: { enabled: boolEnv(env.ENABLE_TELEGRAM, false), configured: secretEnabled(env, 'TELEGRAM_BOT_TOKEN') && secretEnabled(env, 'TELEGRAM_CHAT_ID') },
      discord: { enabled: boolEnv(env.ENABLE_DISCORD, false), configured: secretEnabled(env, 'DISCORD_WEBHOOK_URL') || secretEnabled(env, 'DISCORD_BOT_TOKEN') },
    },
  });
}

// ── Debug endpoints (require ADMIN_TOKEN) ──

async function handleDebugSources(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return json({ error: 'ADMIN_TOKEN 校验失败' }, { status: 403 });
  }
  const storage = await createStorage({ env });
  const latest = await readLatest(storage);
  const sourceStatus = latest?.sourceStatus || {};
  const sourceErrors = latest?.sourceErrors || [];
  return json({ sourceStatus, sourceErrors });
}

async function handleDebugLatest(request, env) {
  if (!isAdminAuthorized(request, env)) {
    return json({ error: 'ADMIN_TOKEN 校验失败' }, { status: 403 });
  }
  const storage = await createStorage({ env });
  const latest = await readLatest(storage);
  if (!latest) return json({ error: 'No latest data' }, { status: 404 });

  // Return shape summary, not raw data
  const summary = {};
  for (const [key, value] of Object.entries(latest)) {
    if (Array.isArray(value)) {
      summary[key] = { type: 'array', length: value.length };
    } else if (value && typeof value === 'object') {
      const subSummary = {};
      for (const [subKey, subValue] of Object.entries(value)) {
        if (Array.isArray(subValue)) {
          subSummary[subKey] = { type: 'array', length: subValue.length };
        } else if (subValue && typeof subValue === 'object') {
          subSummary[subKey] = { type: 'object', keys: Object.keys(subValue).length };
        } else {
          subSummary[subKey] = { type: typeof subValue, value: subValue };
        }
      }
      summary[key] = { type: 'object', children: subSummary };
    } else {
      summary[key] = { type: typeof value, value: value };
    }
  }
  return json(summary);
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const language = getLanguageFromRequest(url, env);

  if (request.method === 'GET' && url.pathname === '/') {
    const storage = await createStorage({ env });
    const latest = await readLatest(storage);
    await queueSweepIfNeeded(env, ctx, storage, latest, 'bootstrap');
    return serveAsset(request, env, latest?.meta ? '/jarvis.html' : '/loading.html', htmlInjection(env, language));
  }

  if (request.method === 'GET' && (url.pathname === '/loading' || url.pathname === '/loading.html')) {
    const storage = await createStorage({ env });
    const latest = await readLatest(storage);
    await queueSweepIfNeeded(env, ctx, storage, latest, 'bootstrap');
    return serveAsset(request, env, '/loading.html', htmlInjection(env, language));
  }

  // ── /api/data: Always return a renderable structure ──
  if (request.method === 'GET' && url.pathname === '/api/data') {
    const storage = await createStorage({ env });
    const latest = await readLatest(storage);
    if (!latest?.meta) {
      await queueSweepIfNeeded(env, ctx, storage, latest, 'data-warmup');
      // Return empty but valid payload so frontend never crashes
      return json(createEmptyPayload(), { status: 503 });
    }
    // Double-normalize to ensure no undefined/NaN leaks
    return json(normalizeDashboardPayload(latest));
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return handleHealth(env);
  }

  if (request.method === 'GET' && url.pathname === '/api/locales') {
    return json({
      current: language,
      supported: getSupportedLocaleInfo(),
      locale: getRuntimeLocale(language),
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json(publicConfig(env, language));
  }

  // ── Debug endpoints ──
  if (request.method === 'GET' && url.pathname === '/api/debug/sources') {
    return handleDebugSources(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/debug/latest') {
    return handleDebugLatest(request, env);
  }

  if (request.method === 'POST' && url.pathname === '/api/sweep') {
    if (!canTriggerSweep(request, env)) {
      return json({
        error: env.ADMIN_TOKEN
          ? 'ADMIN_TOKEN 校验失败'
          : '生产环境未设置 ADMIN_TOKEN，禁止公开触发情报扫描',
      }, { status: 403 });
    }

    ctx.waitUntil(runSweepCycleCloudflare(env, ctx, { trigger: 'manual' }));
    return json({ ok: true, status: 'accepted', message: '情报扫描已加入后台任务' }, { status: 202 });
  }

  if (request.method === 'GET') {
    return env.ASSETS.fetch(request);
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.error('[Worker] 请求处理失败:', err);
      return json({ error: 'Worker 请求处理失败', message: err.message }, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweepCycleCloudflare(env, ctx, { trigger: 'cron', cron: event.cron }));
  },
};
