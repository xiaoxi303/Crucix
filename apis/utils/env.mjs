// Load .env only in the local Node runtime.
// Cloudflare Workers receive vars/secrets through env bindings and must not touch fs/path.

function isCloudflareWorker() {
  return typeof WebSocketPair !== 'undefined'
    || globalThis.navigator?.userAgent === 'Cloudflare-Workers';
}

async function loadNodeEnvFiles() {
  if (isCloudflareWorker()) return;
  if (typeof process === 'undefined' || !process.versions?.node) return;

  const [{ readFileSync }, { resolve, dirname }, { fileURLToPath }] = await Promise.all([
    import('node:fs'),
    import('node:path'),
    import('node:url'),
  ]);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const paths = [
    resolve(__dirname, '..', '..', '.env'),
    resolve(__dirname, '..', '.env'),
  ];

  function loadEnv(filePath) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      let loaded = 0;
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
          loaded++;
        }
      }
      return loaded;
    } catch {
      return -1;
    }
  }

  for (const path of paths) {
    if (loadEnv(path) >= 0) break;
  }
}

await loadNodeEnvFiles();

