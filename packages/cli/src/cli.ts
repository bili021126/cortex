#!/usr/bin/env node

/**
 * cli.ts — Markdown → HTML 命令行转换器
 *
 * 用法:
 *   npx tsx packages/cli/src/cli.ts <输入>.md
 *   npx tsx packages/cli/src/cli.ts <输入>.md -o <输出>.html
 *   npx tsx packages/cli/src/cli.ts <输入>.md --title "文档标题"
 *
 * 默认输出: <输入文件名>.html
 *
 * 原位于 projects/solo-flight/packages/cli/src/cli.ts
 * 适配：使用 @cortex/parser 替代相对路径引用
 */

import fs from 'node:fs';
import path from 'node:path';
import { convert, convertToDocument } from '@cortex/parser';

function printUsage(): void {
  console.error(`
用法: npx tsx packages/cli/src/cli.ts <输入文件> [选项]

参数:
  <输入文件>          输入的 Markdown 文件路径 (.md)

选项:
  -o, --output <文件>  指定输出的 HTML 文件路径
  -t, --title <标题>   指定文档标题（默认取第一个 # 标题）
  -d, --document       输出完整 HTML 文档（含 DOCTYPE/head/style）
  -h, --help           显示帮助信息
`);
}

interface CliOptions {
  input: string;
  output?: string;
  title?: string;
  document?: boolean;
}

function parseArgs(argv: string[]): CliOptions | null {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return null;
  }

  const options: CliOptions = { input: '' };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '-o' || arg === '--output') {
      i++;
      if (i >= args.length) {
        console.error('✗ 错误: --output 需要指定文件路径');
        return null;
      }
      options.output = args[i];
    } else if (arg === '-t' || arg === '--title') {
      i++;
      if (i >= args.length) {
        console.error('✗ 错误: --title 需要指定标题文本');
        return null;
      }
      options.title = args[i];
    } else if (arg === '-d' || arg === '--document') {
      options.document = true;
    } else if (arg.startsWith('-')) {
      console.error(`✗ 错误: 未知选项 "${arg}"`);
      return null;
    } else {
      if (!options.input) {
        options.input = arg;
      } else {
        console.error(`✗ 错误: 多余参数 "${arg}"`);
        return null;
      }
    }
    i++;
  }

  if (!options.input) {
    console.error('✗ 错误: 未指定输入文件');
    return null;
  }

  return options;
}

function main(): void {
  const options = parseArgs(process.argv);
  if (!options) {
    process.exit(1);
  }

  const inputPath = path.resolve(options.input);

  if (!fs.existsSync(inputPath)) {
    console.error(`✗ 错误: 文件不存在 — "${inputPath}"`);
    process.exit(1);
  }

  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== '.md' && ext !== '.markdown') {
    console.error(`⚠  警告: 输入文件扩展名为 "${ext}"，预期为 .md 或 .markdown`);
  }

  let markdown: string;
  try {
    markdown = fs.readFileSync(inputPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ 错误: 读取文件失败 — ${msg}`);
    process.exit(1);
  }

  if (markdown.length === 0) {
    console.error('✗ 错误: 输入文件为空');
    process.exit(1);
  }

  let outputPath: string;
  if (options.output) {
    outputPath = path.resolve(options.output);
  } else {
    const dir = path.dirname(inputPath);
    const basename = path.basename(inputPath, path.extname(inputPath));
    outputPath = path.join(dir, `${basename}.html`);
  }

  let html: string;
  try {
    if (options.document) {
      html = convertToDocument(markdown, options.title);
    } else {
      html = convert(markdown);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ 错误: 转换失败 — ${msg}`);
    process.exit(1);
  }

  try {
    fs.writeFileSync(outputPath, html, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ 错误: 写入文件失败 — ${msg}`);
    process.exit(1);
  }

  console.log(`✓ 转换完成: ${path.basename(inputPath)} → ${path.basename(outputPath)}`);
  console.log(`  输出路径: ${outputPath}`);
  console.log(`  输出大小: ${html.length} 字节`);
}

main();
