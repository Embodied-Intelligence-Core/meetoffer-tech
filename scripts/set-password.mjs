#!/usr/bin/env node
/**
 * 修改站点访问密码。
 *
 * 用法：node scripts/set-password.mjs <新密码>
 * 说明：明文密码不会写入任何文件；仓库中只保存 SHA-256 哈希。
 *      修改后需重启服务（npm start）才会生效。
 */

import { writeFile, readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config.json');
const password = process.argv[2];

if (!password) {
  console.error('用法: node scripts/set-password.mjs <新密码>');
  console.error('示例: npm run password -- "your-new-password"');
  process.exit(1);
}

let cfg = { siteName: 'MeetOffer Tech' };
try {
  cfg = { ...cfg, ...JSON.parse(await readFile(CONFIG, 'utf8')) };
} catch {
  // 首次运行，使用默认值
}

cfg.passwordHash = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
await writeFile(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

console.log('已更新密码哈希 -> config.json');
console.log('明文密码未写入任何文件。请重启服务（npm start）后生效。');
