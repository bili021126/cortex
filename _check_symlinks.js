const fs = require('fs');
const path = require('path');

const nmPath = path.join(__dirname, 'node_modules', '@cortex');
if (!fs.existsSync(nmPath)) {
  console.log('ERROR: node_modules/@cortex not found');
  process.exit(1);
}

const items = fs.readdirSync(nmPath);
console.log('=== node_modules/@cortex symlink check ===');
for (const item of items.sort()) {
  const fullPath = path.join(nmPath, item);
  let stat;
  try {
    stat = fs.lstatSync(fullPath);
  } catch (e) {
    console.log(`  ${item}: ERROR - ${e.message}`);
    continue;
  }
  
  const isSymlink = stat.isSymbolicLink();
  if (isSymlink) {
    const target = fs.readlinkSync(fullPath);
    const targetReal = path.resolve(path.dirname(fullPath), target);
    const exists = fs.existsSync(targetReal);
    console.log(`  ${item}: [symlink] -> ${target}   ${exists ? 'OK' : 'BROKEN'}`);
  } else if (stat.isDirectory()) {
    const pkgJsonPath = path.join(fullPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      console.log(`  ${item}: [dir]  version=${pkg.version}  name=${pkg.name}`);
    } else {
      console.log(`  ${item}: [dir]  no package.json`);
    }
  }
}

// Check for packages that exist in packages/ but not in node_modules/@cortex/
const packagesDir = path.join(__dirname, 'packages');
const pkgItems = fs.readdirSync(packagesDir).filter(i => {
  const p = path.join(packagesDir, i, 'package.json');
  return fs.existsSync(p);
});

const nmItems = new Set(items);
console.log('\n=== Packages in packages/ but NOT in node_modules/@cortex/ ===');
for (const item of pkgItems) {
  if (!nmItems.has(item)) {
    console.log(`  MISSING: ${item}`);
  }
}

console.log('\n=== Packages in node_modules/@cortex/ but NOT in packages/ ===');
for (const item of items) {
  if (!pkgItems.includes(item)) {
    console.log(`  EXTRA: ${item}`);
  }
}

// Check for version mismatches across packages
console.log('\n=== Version alignment check ===');
const allPkgs = {};
for (const item of pkgItems) {
  const p = path.join(packagesDir, item, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
  allPkgs[item] = pkg;
  for (const [depName, depVer] of Object.entries(pkg.dependencies || {})) {
    if (depName.startsWith('@cortex/') && !depVer.startsWith('workspace:')) {
      console.log(`  WARN: ${item} -> ${depName}@${depVer} (not workspace:*)`);
    }
  }
}

console.log('\n=== Circular dependency check (direct cycles only) ===');
const deps = {};
for (const [name, pkg] of Object.entries(allPkgs)) {
  deps[name] = Object.keys(pkg.dependencies || {})
    .filter(d => d.startsWith('@cortex/'))
    .map(d => d.replace('@cortex/', ''));
}

for (const [pkg, depList] of Object.entries(deps)) {
  for (const dep of depList) {
    if (deps[dep] && deps[dep].includes(pkg)) {
      console.log(`  CYCLE: @cortex/${pkg} <-> @cortex/${dep}`);
    }
  }
}

// Check for engines field consistency
console.log('\n=== engines field check ===');
for (const item of pkgItems) {
  const pkg = allPkgs[item];
  if (pkg.engines) {
    console.log(`  ${item}: engines=${JSON.stringify(pkg.engines)}`);
  } else {
    console.log(`  ${item}: NO engines field`);
  }
}

console.log('\nDone.');
