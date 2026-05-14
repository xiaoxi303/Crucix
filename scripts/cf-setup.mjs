#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG_PATH = resolve('wrangler.jsonc');
const BINDING = 'CRUCIX_KV';
const PLACEHOLDER_ID = 'REPLACE_WITH_KV_NAMESPACE_ID';
const PLACEHOLDER_PREVIEW_ID = 'REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID';
const previewOnly = process.argv.includes('--preview-only');

function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runWrangler(args, options = {}) {
  return execFileSync(npxBin(), ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error('未找到 wrangler.jsonc，请先确认项目根目录。');
  }
  return JSON.parse(stripJsonComments(readFileSync(CONFIG_PATH, 'utf8')));
}

function writeConfig(config) {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function parseNamespaceId(output) {
  const jsonMatch = output.match(/"id"\s*:\s*"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const tomlMatch = output.match(/\bid\s*=\s*"([^"]+)"/);
  if (tomlMatch) return tomlMatch[1];
  const textMatch = output.match(/\b([a-f0-9]{32})\b/i);
  if (textMatch) return textMatch[1];
  throw new Error(`无法从 Wrangler 输出中解析 namespace id:\n${output}`);
}

function createNamespace(args) {
  try {
    return parseNamespaceId(runWrangler(['kv', 'namespace', 'create', BINDING, '--json', ...args]));
  } catch (err) {
    const output = runWrangler(['kv', 'namespace', 'create', BINDING, ...args]);
    return parseNamespaceId(output);
  }
}

function hasRealId(value, placeholder) {
  return value && value !== placeholder;
}

function ensureWrangler() {
  console.log('检查 Wrangler...');
  runWrangler(['--version']);
  console.log('检查 Cloudflare 登录状态...');
  runWrangler(['whoami']);
}

function updateKvBinding(id, previewId) {
  const config = readConfig();
  const namespaces = Array.isArray(config.kv_namespaces) ? config.kv_namespaces : [];
  const current = namespaces.find(item => item.binding === BINDING);

  if (current) {
    if (!hasRealId(current.id, PLACEHOLDER_ID) && !hasRealId(current.preview_id, PLACEHOLDER_PREVIEW_ID)) {
      console.log(`wrangler.jsonc 中已有 ${BINDING} 真实绑定，未覆盖。`);
      return;
    }
    current.id = hasRealId(current.id, PLACEHOLDER_ID) ? current.id : id;
    current.preview_id = hasRealId(current.preview_id, PLACEHOLDER_PREVIEW_ID) ? current.preview_id : previewId;
  } else {
    namespaces.push({ binding: BINDING, id, preview_id: previewId });
  }

  config.kv_namespaces = namespaces;
  writeConfig(config);
  console.log('已更新 wrangler.jsonc 的 kv_namespaces。');
}

async function main() {
  ensureWrangler();

  if (previewOnly) {
    console.log('创建 preview KV namespace...');
    const previewId = createNamespace(['--preview']);
    console.log(`preview_id: ${previewId}`);
    return;
  }

  console.log('创建生产 KV namespace...');
  const id = createNamespace([]);
  console.log(`id: ${id}`);

  console.log('创建 preview KV namespace...');
  const previewId = createNamespace(['--preview']);
  console.log(`preview_id: ${previewId}`);

  updateKvBinding(id, previewId);
  console.log('\nCloudflare KV 已准备完成。下一步：');
  console.log('  npm run cf:secret');
  console.log('  npm run cf:deploy');
}

main().catch(err => {
  console.error(`\nCloudflare KV 初始化失败：${err.message}`);
  process.exit(1);
});

