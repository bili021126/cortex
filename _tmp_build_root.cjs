const { spawnSync } = require('child_process');
// Use tsc from shared package
const tscPath = 'D:/cortex/packages/shared/node_modules/typescript/bin/tsc';
const result = spawnSync('node', [tscPath, '--build', 'D:/cortex/tsconfig.json'], {
  cwd: 'D:/cortex',
  shell: true
});
console.log('EXIT_CODE:', result.status);
console.log('---STDOUT---');
console.log(result.stdout.toString().slice(0, 20000));
console.log('---STDERR---');
console.log(result.stderr.toString().slice(0, 20000));
