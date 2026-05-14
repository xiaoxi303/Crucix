// Cloudflare Workers 专用情报扫描入口。
// 不加载 .env，不使用 fs/path/child_process，只复用各 source module 的 fetch 逻辑。

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

const SOURCE_TIMEOUT_MS = 25_000;

function boolEnv(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

export function getCloudflareSourcePlan(env = {}) {
  const enableTelegramSource = boolEnv(env.ENABLE_TELEGRAM_SOURCE, true);
  const enableRedditSource = boolEnv(env.ENABLE_REDDIT_SOURCE, false);

  const sources = [
    { name: 'GDELT', fn: gdelt },
    { name: 'OpenSky', fn: opensky },
    { name: 'FIRMS', fn: firms },
    { name: 'Maritime', fn: ships },
    { name: 'Safecast', fn: safecast },
    { name: 'ACLED', fn: acled },
    { name: 'ReliefWeb', fn: reliefweb },
    { name: 'WHO', fn: who },
    { name: 'OFAC', fn: ofac },
    { name: 'OpenSanctions', fn: opensanctions },
    { name: 'ADS-B', fn: adsb },
    { name: 'FRED', fn: fred, args: [env.FRED_API_KEY] },
    { name: 'Treasury', fn: treasury },
    { name: 'BLS', fn: bls, args: [env.BLS_API_KEY] },
    { name: 'EIA', fn: eia, args: [env.EIA_API_KEY] },
    { name: 'GSCPI', fn: gscpi },
    { name: 'USAspending', fn: usaspending },
    { name: 'Comtrade', fn: comtrade },
    { name: 'NOAA', fn: noaa },
    { name: 'EPA', fn: epa },
    { name: 'Patents', fn: patents },
    { name: 'Bluesky', fn: bluesky },
    {
      name: 'Reddit',
      fn: null,
      enabled: enableRedditSource,
      disabledReason: 'Cloudflare 默认关闭 Reddit OAuth 源，设置 ENABLE_REDDIT_SOURCE=true 后可启用。',
    },
    { name: 'Telegram', fn: telegram, enabled: enableTelegramSource },
    { name: 'KiwiSDR', fn: kiwisdr },
    { name: 'Space', fn: space },
    { name: 'YFinance', fn: yfinance },
    { name: 'CISA-KEV', fn: cisaKev },
    { name: 'Cloudflare-Radar', fn: cloudflareRadar },
  ];

  return sources.map(source => {
    if (source.name === 'Reddit' && enableRedditSource) {
      return {
        ...source,
        fn: async () => ({
          source: 'Reddit',
          status: 'disabled',
          message: 'Reddit OAuth 依赖 Basic Auth/Buffer，Cloudflare 版默认不加载该源。',
        }),
      };
    }
    return { enabled: source.enabled !== false, args: [], ...source };
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

  const output = {
    crucix: {
      version: '2.0.0-cloudflare',
      runtime: 'cloudflare',
      timestamp: new Date().toISOString(),
      totalDurationMs: Date.now() - start,
      sourcesQueried: sources.length,
      sourcesOk: sources.filter(source => source.status === 'ok').length,
      sourcesFailed: sources.filter(source => source.status !== 'ok').length,
      sourcesDisabled: disabled.length,
    },
    sources: Object.fromEntries(sources.filter(source => source.status === 'ok').map(source => [source.name, source.data])),
    errors: sources.filter(source => source.status !== 'ok').map(source => ({ name: source.name, error: source.error })),
    disabledSources: disabled.map(source => ({ name: source.name, reason: source.disabledReason || 'disabled by config' })),
    timing: Object.fromEntries(sources.map(source => [source.name, { status: source.status, ms: source.durationMs }])),
  };

  return output;
}

