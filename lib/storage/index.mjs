export async function createStorage(options = {}) {
  const env = options.env || {};
  if (env.CRUCIX_KV) {
    const { KVStorage } = await import('./kv-storage.mjs');
    return new KVStorage(env.CRUCIX_KV, options);
  }

  const { FSStorage } = await import('./fs-storage.mjs');
  return new FSStorage(options.rootDir || './runs', options);
}

export const STORAGE_KEYS = Object.freeze({
  latest: 'latest',
  memoryHot: 'memory:hot',
  memoryCold: date => `memory:cold:${date}`,
  metaLastSweep: 'meta:last-sweep',
  metaHealth: 'meta:health',
  metaLastSuccessfulSweep: 'meta:last-successful-sweep',
  metaLastFailedSweep: 'meta:last-failed-sweep',
  sourceLastGood: name => `source:${name}:last-good`,
  configUser: 'config:user',
});
