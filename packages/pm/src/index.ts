#!/usr/bin/env node

/**
 * index.ts — 命令行密码管理器入口
 *
 * 用法:
 *   npx tsx packages/pm/src/index.ts add -n <name> -u <username> -p <password>
 *   npx tsx packages/pm/src/index.ts get -n <name>
 *   npx tsx packages/pm/src/index.ts list
 *
 * 原位于 projects/solo-flight/src/index.ts
 */

import { Command } from 'commander';
import { addEntry, getEntry, listEntries } from './store.js';

const program = new Command();

program
  .name('pm')
  .description('命令行密码管理器 — AES-256-GCM 加密存储')
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
      console.log('（空 — 尚未添加任何密码条目）');
      return;
    }
    console.log(`共 ${entries.length} 个条目:\n`);
    for (const entry of entries) {
      console.log(`  [${entry.id.slice(0, 8)}] ${entry.name}`);
      console.log(`        创建于 ${entry.createdAt}\n`);
    }
  });

program.parse(process.argv);
