#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * index.ts -- @cortex/pm 公开 API
 *
 * 命令行密码管理器 -- AES-256-GCM 加密存储
 *
 * 用法（CLI）:
 *   npx tsx packages/pm/src/index.ts add -n <name> -u <username> -p <password>
 *   npx tsx packages/pm/src/index.ts get -n <name>
 *   npx tsx packages/pm/src/index.ts list
 *
 * 用法（API）:
 *   import { encrypt, decrypt, addEntry, getEntry, listEntries } from '@cortex/pm';
 *
 * 原位于 projects/solo-flight/src/index.ts
 */

// ── 公开 API ──────────────────────────────────────────

export { encrypt, decrypt } from './crypto.js';
export { addEntry, getEntry, listEntries } from './store.js';
export type { PasswordEntry } from './store.js';

// ── CLI 入口（仅在直接运行时触发）────────────────────

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { addEntry, getEntry, listEntries } from './store.js';

function runCli(): void {
  const program = new Command();

  program
    .name('pm')
    .description('命令行密码管理器 -- AES-256-GCM 加密存储')
    .version('1.0.0');

  program
    .command('add')
    .description('添加密码条目')
    .requiredOption('-n, --name <name>', '条目名称（唯一标识）')
    .requiredOption('-u, --username <username>', '用户名')
    .requiredOption('-p, --password <password>', '密码')
    .action((options) => {
      try {
        const entry = addEntry(options.name, options.username, options.password);
        console.log(`✓ 已添加条目: ${entry.name}`);
        console.log(`  ID:       ${entry.id}`);
        console.log(`  用户名:   ${entry.username}`);
        console.log(`  创建时间: ${entry.createdAt}`);
      } catch (err) {
        if (err instanceof Error) {
          console.error(`✗ 添加失败: ${err.message}`);
          process.exit(1);
        }
      }
    });

  program
    .command('get')
    .description('获取密码条目详情')
    .requiredOption('-n, --name <name>', '条目名称')
    .action((options) => {
      const entry = getEntry(options.name);
      if (!entry) {
        console.error(`✗ 未找到条目: "${options.name}"`);
        process.exit(1);
      }
      console.log(`名称:     ${entry.name}`);
      console.log(`用户名:   ${entry.username}`);
      console.log(`密码:     ${entry.password}`);
      console.log(`创建时间: ${entry.createdAt}`);
      console.log(`更新时间: ${entry.updatedAt}`);
    });

  program
    .command('list')
    .description('列出所有密码条目')
    .action(() => {
      const entries = listEntries();
      if (entries.length === 0) {
        console.log('（空 -- 尚未添加任何密码条目）');
        return;
      }
      console.log(`共 ${entries.length} 个条目:\n`);
      for (const entry of entries) {
        console.log(`  [${entry.id.slice(0, 8)}] ${entry.name}`);
        console.log(`        创建于 ${entry.createdAt}\n`);
      }
    });

  program.parse(process.argv);
}

/**
 * 检测当前模块是否作为 CLI 入口被直接运行。
 *
 * @fix P0-3 — 使用 import.meta.url 与 process.argv[1] 的绝对路径比较，
 *   替代脆弱的子串匹配（includes('packages/pm/src/index') + endsWith('pm')）。
 *   新方案：
 *   1. 将 import.meta.url 转为绝对路径
 *   2. 将 process.argv[1] 转为绝对路径（若为相对路径）
 *   3. 比较两者是否一致
 *   在 tsx/ts-node 等运行时下，entry 路径可能携带 .ts 后缀而 import.meta.url 固定为 .ts，
 *   因此还检查去掉扩展名后是否匹配。
 */
function isCliEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;

  const thisFile = fileURLToPath(import.meta.url);
  const resolvedEntry = resolve(entryArg);

  // 精确匹配
  if (thisFile === resolvedEntry) return true;

  // 去掉扩展名后匹配（兼容 tsx 运行时下 argv[1] 为 .ts 而 import.meta.url 为 .ts 的情况）
  const stripExt = (p: string) => p.replace(/\.(ts|js|mjs)$/, '');
  if (stripExt(thisFile) === stripExt(resolvedEntry)) return true;

  // 兜底：匹配文件名（npm link / bin 场景）
  if (resolvedEntry.endsWith('/pm') || resolvedEntry.endsWith('\\pm')) return true;

  return false;
}

// 仅在直接运行时执行 CLI（而非作为库导入时）
if (isCliEntry()) {
  runCli();
}
