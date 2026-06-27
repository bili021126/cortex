const { spawnSync } = require('child_process');
const path = require('path');

const tscPath = 'D:/cortex/packages/shared/node_modules/typescript/bin/tsc';
const base = 'D:/cortex/packages';

// Build order: leaf packages first (no workspace deps), then those that depend on them
const packages = [
  { name: 'shared', tsconfig: null, desc: '@cortex/shared (leaf)' },
  { name: 'config', tsconfig: null, desc: '@cortex/config (depends shared)' },
  { name: 'testing', tsconfig: null, desc: '@cortex/testing (leaf)' },
  { name: 'parser', tsconfig: null, desc: '@cortex/parser (leaf)' },
  { name: 'prompt-kit', tsconfig: null, desc: '@cortex/prompt-kit (leaf)' },
  { name: 'resilience', tsconfig: null, desc: '@cortex/resilience (leaf)' },
  { name: 'telemetry', tsconfig: null, desc: '@cortex/telemetry (leaf)' },
  { name: 'notification', tsconfig: null, desc: '@cortex/notification' },
  { name: 'llm', tsconfig: null, desc: '@cortex/llm (depends config/shared)' },
  { name: 'memory', tsconfig: null, desc: '@cortex/memory (depends config/shared)' },
  { name: 'logging', tsconfig: null, desc: '@cortex/logging' },
  { name: 'pattern-extractor', tsconfig: null, desc: '@cortex/pattern-extractor' },
  { name: 'tools', tsconfig: null, desc: '@cortex/tools' },
  { name: 'memory-store', tsconfig: 'tsconfig.src.json', desc: '@cortex/memory-store' },
  { name: 'consistency', tsconfig: 'tsconfig.src.json', desc: '@cortex/consistency' },
  { name: 'fsm-compiler', tsconfig: 'tsconfig.src.json', desc: '@cortex/fsm-compiler' },
  { name: 'platform', tsconfig: null, desc: '@cortex/platform' },
  { name: 'scheduler', tsconfig: null, desc: '@cortex/scheduler' },
  { name: 'governance', tsconfig: 'tsconfig.src.json', desc: '@cortex/governance' },
  { name: 'skill-kit', tsconfig: null, desc: '@cortex/skill-kit' },
  { name: 'plugin-runner', tsconfig: 'tsconfig.src.json', desc: '@cortex/plugin-runner' },
  { name: 'context-manager', tsconfig: null, desc: '@cortex/context-manager' },
  { name: 'engine', tsconfig: 'tsconfig.src.json', desc: '@cortex/engine (core)' },
  { name: 'cli', tsconfig: null, desc: '@cortex/cli' },
  { name: 'tui', tsconfig: null, desc: '@cortex/tui' },
  { name: 'doctor', tsconfig: null, desc: '@cortex/doctor' },
];

let successCount = 0;
let failCount = 0;

for (const pkg of packages) {
  const tsconfigName = pkg.tsconfig || 'tsconfig.json';
  const tsconfigPath = path.join(base, pkg.name, tsconfigName);
  
  // Check if tsconfig exists
  if (!require('fs').existsSync(tsconfigPath)) {
    console.log(`--- ${pkg.desc} --- tsconfig not found at ${tsconfigPath}, skipping`);
    continue;
  }
  
  console.log(`\n>>> Building ${pkg.desc} (${tsconfigPath})...`);
  const result = spawnSync('node', [tscPath, '-p', tsconfigPath, '--noEmit'], {
    cwd: 'D:/cortex',
    shell: true
  });
  
  if (result.status === 0) {
    console.log(`>>> ${pkg.desc}: ✅ PASS (--noEmit)`);
    // Now build for real to produce dist
    const buildResult = spawnSync('node', [tscPath, '-p', tsconfigPath], {
      cwd: 'D:/cortex',
      shell: true
    });
    if (buildResult.status === 0) {
      console.log(`>>> ${pkg.desc}: ✅ BUILD SUCCESS`);
      successCount++;
    } else {
      console.log(`>>> ${pkg.desc}: ❌ BUILD FAILED`);
      console.log(buildResult.stdout.toString().slice(0, 3000));
      failCount++;
    }
  } else {
    console.log(`>>> ${pkg.desc}: ❌ FAILED`);
    console.log(result.stdout.toString().slice(0, 3000));
    failCount++;
  }
}

console.log(`\n========================================`);
console.log(`Build Summary: ${successCount} passed, ${failCount} failed`);
