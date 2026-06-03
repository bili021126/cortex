const fs = require('fs');
const path = 'd:/cortex/scripts/inject-cyrene-memories.ts';

let s = fs.readFileSync(path, 'utf8');
console.log('Before length:', s.length);

// Replace known mojibake: U+FFFD followed by ?
// The actual bytes are: EF BF BD 3F which is �?
const bad = '\uFFFD?';
const good = '';
const before = s.length;
s = s.split(bad).join(good);
console.log('Replaced', before - s.length, 'chars of mojibake');

// Now do the actual intended replacement
const before2 = s.length;
s = s.replace(/三千万世/g, '33,550,337次轮回');
console.log('Replaced 三千万世 -> 33,550,337次轮回');

fs.writeFileSync(path, s, 'utf8');
console.log('After length:', s.length);
console.log('Done');
