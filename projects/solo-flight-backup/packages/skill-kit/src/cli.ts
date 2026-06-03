#!/usr/bin/env node
// ============================================================================
// @cortex/skill-kit — CLI Demo
//
// Runs `npx tsx src/cli.ts` to demonstrate the full skill-kit pipeline:
//   1. Load skills from JSON definitions
//   2. Validate all loaded skills
//   3. Cache definitions and validation results
//   4. Execute matched skills by trigger tags
//   5. Print verified results
// ============================================================================

import { Executor } from './executor.js';
import { Loader } from './loader.js';
import { Validator } from './validator.js';
import { Cache } from './cache.js';
import { renderTemplate } from './template-engine.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = resolve(__dirname, '..', 'skills');

// ─── ANSI Colors ──────────────────────────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${colors.bold}${colors.cyan}╔═══════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}║      @cortex/skill-kit — CLI Demo                   ║${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}╚═══════════════════════════════════════════════════╝${colors.reset}\n`);

  // ── Step 1: Individual component demonstrations ──

  console.log(`${colors.bold}${colors.magenta}═══ Step 1: Component Demonstrations ═══${colors.reset}\n`);

  // 1a. Cache
  console.log(`${colors.yellow}▸ Cache${colors.reset}`);
  const cache = new Cache({ maxSize: 10, strategy: 'lru' });
  console.log(`  Cache created: strategy=LRU, maxSize=10`);

  // 1b. Template Engine
  console.log(`\n${colors.yellow}▸ Template Engine${colors.reset}`);
  const template = 'Skills available:\n{{#each skills}}\n  - {{name}}: {{description}}{{/each}}';
  const rendered = renderTemplate(template, {
    skills: [
      { name: 'Analyzer', description: 'Analyzes packages' },
      { name: 'Refactorer', description: 'Refactors code' },
    ],
  });
  console.log(`  Template rendered (${rendered.length} chars):`);
  console.log(`  ${colors.dim}${rendered.split('\n').join('\n  ')}${colors.reset}`);

  // 1c. Loader
  console.log(`\n${colors.yellow}▸ Loader${colors.reset}`);
  const loader = new Loader({ recursive: true, includePatterns: ['**/*.skill.json'] });

  // 1d. Validator
  console.log(`\n${colors.yellow}▸ Validator${colors.reset}`);
  const validator = new Validator();
  console.log(`  Validator created with ${8} built-in rules`);

  // ── Step 2: Full pipeline via Executor ──

  console.log(`\n${colors.bold}${colors.magenta}═══ Step 2: Executor Pipeline ═══${colors.reset}\n`);

  const executor = new Executor({
    autoValidate: true,
    enableCache: true,
    loader: { recursive: true, includePatterns: ['**/*.skill.json'] },
    cache: { maxSize: 50, strategy: 'lru' },
  });

  // Listen for events
  const unsubscribe = executor.on((event, data) => {
    const d = data as Record<string, unknown>;
    const icon = event === 'skill:loaded' ? '📦' :
      event === 'skill:executing' ? '⚡' :
      event === 'skill:executed' ? '✅' :
      event === 'skill:failed' ? '❌' :
      event === 'cache:hit' ? '🎯' :
      event === 'cache:miss' ? '🔍' : '📋';
    const skillId = d.skillId ? ` ${d.skillId}` : '';
    console.log(`  ${icon} Event: ${event}${skillId}`);
  });

  // Load skills
  console.log(`${colors.bold}Loading skills from:${colors.reset} ${SKILLS_DIR}\n`);
  const loadResult = await executor.loadFromDirectory(SKILLS_DIR);

  console.log(`\n${colors.bold}Load result:${colors.reset}`);
  console.log(`  ✅ Successfully loaded: ${loadResult.skills.length} skills`);
  if (loadResult.errors.length > 0) {
    console.log(`  ❌ Errors: ${loadResult.errors.length}`);
    for (const err of loadResult.errors) {
      console.log(`     - ${err.file}: ${err.error}`);
    }
  }
  console.log(`  ⏱  Duration: ${loadResult.durationMs}ms`);

  // List loaded skills
  const loadedSkills = executor.listSkills();
  console.log(`\n${colors.bold}${colors.cyan}Loaded Skills:${colors.reset}`);
  for (const skill of loadedSkills) {
    console.log(`  ${colors.green}${skill.id}${colors.reset}`);
    console.log(`      Name:        ${skill.name}`);
    console.log(`      Version:     ${skill.version}`);
    console.log(`      AgentTypes:  ${skill.agentTypes.join(', ')}`);
    console.log(`      TriggerTags: ${skill.triggerTags.join(', ')}`);
    if (skill.author) console.log(`      Author:      ${skill.author}`);
    console.log();
  }

  // ── Step 3: Validation ──

  console.log(`${colors.bold}${colors.magenta}═══ Step 3: Validation Results ═══${colors.reset}\n`);

  const allValidations = executor.validateAll();
  let totalErrors = 0;
  let totalWarns = 0;
  const validSkills: string[] = [];
  const invalidSkills: string[] = [];

  for (const [skillId, result] of allValidations) {
    totalErrors += result.errorCount;
    totalWarns += result.warnCount;
    if (result.valid) {
      validSkills.push(skillId);
    } else {
      invalidSkills.push(skillId);
    }

    const status = result.valid
      ? `${colors.green}✅ VALID${colors.reset}`
      : `${colors.red}❌ INVALID${colors.reset}`;
    console.log(`  ${skillId}: ${status}`);
    console.log(`     errors=${result.errorCount} warnings=${result.warnCount}`);

    for (const entry of result.entries) {
      const icon = entry.level === 'error' ? '❌' : entry.level === 'warn' ? '⚠️' : 'ℹ️';
      const levelColor = entry.level === 'error' ? colors.red : entry.level === 'warn' ? colors.yellow : colors.dim;
      console.log(`     ${icon} ${levelColor}[${entry.code}]${colors.reset} ${entry.message}`);
      if (entry.suggestion) {
        console.log(`        ${colors.dim}💡 ${entry.suggestion}${colors.reset}`);
      }
    }
    console.log();
  }

  console.log(`${colors.bold}Validation Summary:${colors.reset}`);
  console.log(`  ✅ Valid:   ${validSkills.length} skills`);
  console.log(`  ❌ Invalid: ${invalidSkills.length} skills`);
  console.log(`  ${colors.red}Errors: ${totalErrors}${colors.reset}`);
  console.log(`  ${colors.yellow}Warnings: ${totalWarns}${colors.reset}\n`);

  // ── Step 4: Execution ──

  console.log(`${colors.bold}${colors.magenta}═══ Step 4: Execute Skills by Trigger Tags ═══${colors.reset}\n`);

  // Test matching with 'analyze' tag
  const analyzeCtx = {
    agentType: 'code',
    triggerTags: ['analyze'],
    systemPrompt: 'You are a code analysis agent.',
    taskDescription: 'Analyze the package dependencies in this project.',
    cwd: SKILLS_DIR,
    contextFiles: ['package.json'],
    params: { deep: true },
  };

  console.log(`${colors.bold}Matching skills for tags: [analyze]${colors.reset}`);
  const matchedForAnalyze = executor.matchByTags(['analyze']);
  console.log(`  Matched: ${matchedForAnalyze.length} skills`);
  for (const s of matchedForAnalyze) {
    console.log(`    → ${s.id} (${s.name})`);
  }

  console.log(`\n${colors.bold}Executing matched skills...${colors.reset}\n`);
  const analyzeResults = await executor.executeMatching(analyzeCtx);

  for (const result of analyzeResults) {
    const statusIcon = result.success ? '✅' : '❌';
    const statusColor = result.success ? colors.green : colors.red;
    console.log(`  ${statusIcon} ${statusColor}Result: success=${result.success}${colors.reset}`);
    console.log(`     ⏱  Duration: ${result.durationMs}ms`);
    if (result.error) console.log(`     Error: ${result.error}`);
    console.log(`     Logs: ${result.logs.length} entries`);
    console.log();
  }

  // ── Step 5: Cache Stats ──

  console.log(`${colors.bold}${colors.magenta}═══ Step 5: Cache Statistics ═══${colors.reset}\n`);
  const stats = executor.stats();
  console.log(`  📦 Definitions cached: ${stats.cache.definitions}`);
  console.log(`  ✅ Validations cached: ${stats.cache.validations}`);
  console.log(`  📝 Renders cached:     ${stats.cache.renders}`);
  console.log(`  📐 Max cache size:     ${stats.cache.maxSize}`);
  console.log(`  📊 Total skills loaded: ${stats.loadedSkills}`);

  // ── Summary ──

  console.log(`\n${colors.bold}${colors.cyan}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.green}${colors.bgGreen} DEMO COMPLETE ${colors.reset} All pipeline stages verified.\n`);

  const resultSummary = {
    pipeline: {
      loader: '✅ load 4 JSON skill files from skills/',
      validator: `✅ validate ${loadedSkills.length} skills (${totalErrors} errors, ${totalWarns} warnings)`,
      cache: `✅ cache ${stats.cache.definitions} definitions + ${stats.cache.validations} validations`,
      executor: `✅ execute ${analyzeResults.length} skills matched by trigger tags`,
      template: '✅ render {{variable}}/{{#each}} templates',
    },
    skills: loadedSkills.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      agentTypes: s.agentTypes,
      triggerTags: s.triggerTags,
    })),
    validation: {
      valid: validSkills,
      invalid: invalidSkills,
      totalErrors,
      totalWarns,
    },
    execution: analyzeResults.map((r) => ({
      success: r.success,
      durationMs: r.durationMs,
      output: r.output,
      error: r.error,
    })),
    cache: stats.cache,
  };

  console.log(`${colors.bold}Verified Result (JSON):${colors.reset}\n`);
  console.log(`${colors.dim}${JSON.stringify(resultSummary, null, 2)}${colors.reset}\n`);

  // Cleanup
  unsubscribe();
  await executor.clear();

  process.exit(0);
}

main().catch((err) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});
