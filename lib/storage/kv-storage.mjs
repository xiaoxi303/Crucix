const DEFAULT_MAX_JSON_BYTES = 20 * 1024 * 1024;

function isJsonLike(value) {
  return value !== null && (Array.isArray(value) || typeof value === 'object');
}

function fallbackFor(value, fallback) {
  return value === undefined ? fallback : value;
}

export class KVStorage {
  constructor(namespace, options = {}) {
    this.namespace = namespace;
    this.maxJsonBytes = options.maxJsonBytes || DEFAULT_MAX_JSON_BYTES;
    this.type = 'kv';
  }

  get isAvailable() {
    return !!this.namespace;
  }

  async getJSON(key, fallback = null) {
    if (!this.namespace) return fallback;

    try {
      const value = await this.namespace.get(key, { type: 'json' });
      return fallbackFor(value, fallback);
    } catch (err) {
      console.warn(`[storage:kv] 读取 ${key} 失败: ${err.message}`);
      return fallback;
    }
  }

  async putJSON(key, value, options = {}) {
    if (!this.namespace) {
      return { ok: false, error: 'CRUCIX_KV 未绑定' };
    }
    if (!isJsonLike(value)) {
      return { ok: false, error: `拒绝写入非 JSON 对象: ${key}` };
    }

    try {
      const body = JSON.stringify(value);
      const bytes = new TextEncoder().encode(body).byteLength;
      const maxJsonBytes = options.maxJsonBytes || this.maxJsonBytes;
      if (bytes > maxJsonBytes) {
        return { ok: false, error: `${key} 超过 KV 单值安全大小限制 (${bytes} bytes)` };
      }

      await this.namespace.put(key, body, {
        metadata: {
          contentType: 'application/json',
          updatedAt: new Date().toISOString(),
          bytes,
        },
      });
      return { ok: true, bytes };
    } catch (err) {
      console.warn(`[storage:kv] 写入 ${key} 失败: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  async delete(key) {
    if (!this.namespace) return { ok: false, error: 'CRUCIX_KV 未绑定' };
    try {
      await this.namespace.delete(key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async healthCheck() {
    if (!this.namespace) {
      return { ok: false, type: this.type, error: 'CRUCIX_KV 未绑定' };
    }

    try {
      await this.namespace.get('meta:health');
      return { ok: true, type: this.type };
    } catch (err) {
      return { ok: false, type: this.type, error: err.message };
    }
  }
}

