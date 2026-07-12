const { spawnSync } = require('child_process');
const result = spawnSync('node', [
  'D:/cortex/packages/engine/node_modules/typescript/bin/tsc',
  '--build',
  'D:/cortex/packages/engine/tsconfig.src.json'
], {
  cwd: 'D:/cortex/packages/engine',
  shell: true
});
console.log('EXIT_CODE:', result.status);
console.log('---STDOUT---');
console.log(result.stdout.toString().slice(0, 10000));
console.log('---STDERR---');
console.log(result.stderr.toString().slice(0, 10000));
