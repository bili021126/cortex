const fs = require('fs');
const path = require('path');
const base = 'D:/cortex/packages';
const dirs = [
  'plugin-runner', 'engine', 'governance', 'consistency',
  'platform', 'scheduler', 'skill-kit', 'llm', 'plugin-runner',
  'telemetry', 'memory', 'notification', 'logging',
  'context-manager', 'memory-store', 'fsm-compiler',
  'shared', 'config', 'cli', 'testing', 'tui',
  'doctor', 'prompt-kit', 'parser', 'pattern-extractor',
  'resilience', 'tools', 'doctor', 'logging'
];
dirs.forEach(p => {
  const d = path.join(base, p, 'dist');
  if (fs.existsSync(d)) {
    fs.rmSync(d, { recursive: true, force: true });
    console.log('cleaned:', d);
  }
});
console.log('Done cleaning all dist directories');
