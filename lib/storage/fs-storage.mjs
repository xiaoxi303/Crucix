import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_MAX_JSON_BYTES = 20 * 1024 * 1024;

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function isJsonLike(value) {
  return value !== null && (Array.isArray(value) || typeof value === 'object');
}

export class FSStorage {
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.maxJsonBytes = options.maxJsonBytes || DEFAULT_MAX_JSON_BYTES;
    this.type = 'fs';
  }

  get isAvailable() {
    return true;
  }

  keyToPath(key) {
    if (key === 'latest') return join(this.rootDir, 'latest.json');
    if (key === 'memory:hot') return join(this.rootDir, 'memory', 'hot.json');
    if (key.startsWith('memory:cold:')) {
      return join(this.rootDir, 'memory', 'cold', `${key.slice('memory:cold:'.length)}.json`);
    }
    if (key.startsWith('meta:')) return join(this.rootDir, 'meta', `${key.slice('meta:'.length)}.json`);
    if (key.startsWith('config:')) return join(this.rootDir, 'config', `${key.slice('config:'.length)}.json`);
    return join(this.rootDir, `${key.replace(/:/g, '-')}.json`);
  }

  async getJSON(key, fallback = null) {
    try {
      const filePath = this.keyToPath(key);
      if (!existsSync(filePath)) return fallback;
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      return data === undefined ? fallback : data;
    } catch (err) {
      console.warn(`[storage:fs] 读取 ${key} 失败: ${err.message}`);
      return fallback;
    }
  }

  async putJSON(key, value, options = {}) {
    if (!isJsonLike(value)) {
      return { ok: false, error: `拒绝写入非 JSON 对象: ${key}` };
    }

    try {
      const body = JSON.stringify(value, null, 2);
      const bytes = Buffer.byteLength(body, 'utf8');
      const maxJsonBytes = options.maxJsonBytes || this.maxJsonBytes;
      if (bytes > maxJsonBytes) {
        return { ok: false, error: `${key} 超过本地 JSON 安全大小限制 (${bytes} bytes)` };
      }

      const filePath = this.keyToPath(key);
      ensureDir(filePath);
      const tmpPath = `${filePath}.tmp`;
      writeFileSync(tmpPath, body);
      renameSync(tmpPath, filePath);
      return { ok: true, bytes };
    } catch (err) {
      console.warn(`[storage:fs] 写入 ${key} 失败: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async healthCheck() {
    try {
      mkdirSync(this.rootDir, { recursive: true });
      return { ok: true, type: this.type };
    } catch (err) {
      return { ok: false, type: this.type, error: err.message };
    }
  }
}

