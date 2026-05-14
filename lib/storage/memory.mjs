import { computeDelta } from '../delta/engine.mjs';
import { STORAGE_KEYS } from './index.mjs';

const MAX_HOT_RUNS = 3;

function validHotMemory(data) {
  return data && Array.isArray(data.runs) && data.alertedSignals && typeof data.alertedSignals === 'object';
}

export class StorageMemoryManager {
  constructor(storage, hotMemory) {
    this.storage = storage;
    this.hot = validHotMemory(hotMemory) ? hotMemory : { runs: [], alertedSignals: {} };
  }

  static async create(storage) {
    const hot = await storage.getJSON(STORAGE_KEYS.memoryHot, null);
    return new StorageMemoryManager(storage, hot);
  }

  getLastRun() {
    return this.hot.runs[0]?.data || null;
  }

  getRunHistory(n = 3) {
    return this.hot.runs.slice(0, n);
  }

  getLastDelta() {
    return this.hot.runs[0]?.delta || null;
  }

  async addRun(synthesizedData) {
    const previous = this.getLastRun();
    const priorRuns = this.hot.runs.map(run => run.data);
    const delta = computeDelta(synthesizedData, previous, {}, priorRuns);
    const compact = this.compactForStorage(synthesizedData);

    this.hot.runs.unshift({
      timestamp: synthesizedData.meta?.timestamp || new Date().toISOString(),
      data: compact,
      delta,
    });

    if (this.hot.runs.length > MAX_HOT_RUNS) {
      const archived = this.hot.runs.splice(MAX_HOT_RUNS);
      await this.archiveToCold(archived);
    }

    await this.storage.putJSON(STORAGE_KEYS.memoryHot, this.hot);
    return delta;
  }

  async pruneAlertedSignals() {
    const now = Date.now();
    for (const [key, entry] of Object.entries(this.hot.alertedSignals || {})) {
      const lastTime = new Date(typeof entry === 'object' ? entry.lastAlerted : entry).getTime();
      const count = typeof entry === 'object' ? (entry.count || 1) : 1;
      const maxAge = count >= 2 ? 48 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if (Number.isFinite(lastTime) && now - lastTime > maxAge) delete this.hot.alertedSignals[key];
    }
    await this.storage.putJSON(STORAGE_KEYS.memoryHot, this.hot);
  }

  compactForStorage(data) {
    return {
      meta: data.meta,
      fred: data.fred,
      energy: data.energy,
      metals: data.metals,
      bls: data.bls,
      treasury: data.treasury,
      gscpi: data.gscpi,
      tg: {
        posts: data.tg?.posts || 0,
        urgent: (data.tg?.urgent || []).map(post => ({
          text: post.text,
          date: post.date,
          channel: post.channel || post.chat || null,
          postId: post.postId || null,
        })),
      },
      thermal: (data.thermal || []).map(item => ({
        region: item.region,
        det: item.det,
        night: item.night,
        hc: item.hc,
      })),
      air: (data.air || []).map(item => ({ region: item.region, total: item.total })),
      nuke: (data.nuke || []).map(item => ({ site: item.site, anom: item.anom, cpm: item.cpm })),
      who: (data.who || []).map(item => ({ title: item.title })),
      acled: {
        totalEvents: data.acled?.totalEvents || 0,
        totalFatalities: data.acled?.totalFatalities || 0,
      },
      sdr: { total: data.sdr?.total || 0, online: data.sdr?.online || 0 },
      news: { count: data.news?.length || 0 },
      ideas: (data.ideas || []).map(item => ({
        title: item.title,
        type: item.type,
        confidence: item.confidence,
      })),
    };
  }

  async archiveToCold(runs) {
    if (!runs.length) return;
    const dateKey = new Date().toISOString().slice(0, 10);
    const key = STORAGE_KEYS.memoryCold(dateKey);
    const existing = await this.storage.getJSON(key, []);
    const next = Array.isArray(existing) ? existing.concat(runs) : runs;
    await this.storage.putJSON(key, next);
  }
}

