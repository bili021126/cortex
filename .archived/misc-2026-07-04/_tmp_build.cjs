const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const tsc = 'D:/cortex/packages/shared/node_modules/typescript/bin/tsc';

function buildPkg(name, tsconfig) {
  const cfg = tsconfig || 'tsconfig.json';
  const p = `D:/cortex/packages/${name}/${cfg}`;
  if (!fs.existsSync(p)) return 'SKIP';
  const r = spawnSync('node', [tsc, '-p', p], { cwd: 'D:/cortex', shell: true });
  const out = (r.stdout || '').toString().slice(0, 2000);
  return { code: r.status, out };
}

const pkgs = ['shared','config','testing','parser','prompt-kit','resilience','telemetry',
  'notification','llm','memory','logging','pattern-extractor','tools',
  {n:'memory-store',c:'tsconfig.src.json'},{n:'consistency',c:'tsconfig.src.json'},
  {n:'fsm-compiler',c:'tsconfig.src.json'},'platform','scheduler',
  {n:'governance',c:'tsconfig.src.json'},'skill-kit',
  {n:'plugin-runner',c:'tsconfig.src.json'},'context-manager',
  {n:'engine',c:'tsconfig.src.json'},'cli','tui','doctor'];

let ok = 0, fail = 0;
for (const p of pkgs) {
  const name = typeof p === 'string' ? p : p.n;
  const cfg = typeof p === 'string' ? null : p.c;
  console.log(`\n--- ${name} ---`);
  const r = buildPkg(name, cfg);
  if (r === 'SKIP') { console.log('SKIP (no tsconfig)'); continue; }
  if (r.code === 0) { console.log('OK'); ok++; }
  else { console.log(`FAIL (exit ${r.code})`); if (r.out) console.log(r.out.slice(0, 500)); fail++; }
}
console.log(`\n=== Summary: ${ok} OK, ${fail} FAIL ===`);
