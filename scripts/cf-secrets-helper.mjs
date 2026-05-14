#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SECRETS = [
  'FRED_API_KEY',
  'FIRMS_MAP_KEY',
  'EIA_API_KEY',
  'AISSTREAM_API_KEY',
  'ACLED_EMAIL',
  'ACLED_PASSWORD',
  'CLOUDFLARE_API_TOKEN',
  'LLM_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DISCORD_BOT_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_CHANNEL_ID',
  'DISCORD_GUILD_ID',
  'ADMIN_TOKEN'
];

function npxBin() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function putSecret(key) {
  const result = spawnSync(npxBin(), ['wrangler', 'secret', 'put', key], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${key} 设置失败`);
  }
}

async function main() {
  console.log('Cloudflare Secrets 设置助手');
  console.log('不会把 secret 写入任何文件；Wrangler 会安全地提交到 Cloudflare。');
  const rl = readline.createInterface({ input, output });

  try {
    for (const key of SECRETS) {
      const answer = await rl.question(`是否设置 ${key}? (y/N) `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log(`跳过 ${key}`);
        continue;
      }
      putSecret(key);
    }
  } finally {
    rl.close();
  }

  console.log('\nSecrets 设置流程结束。可继续执行：npm run cf:deploy');
}

main().catch(err => {
  console.error(`\nSecret 设置失败：${err.message}`);
  process.exit(1);
});

