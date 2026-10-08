// Self-contained script sent to Node in the final runner image; no installed
// scanner, host mount, root access, package install, or network access needed.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = process.argv[2] ?? '/app';
const seen = new Set();
const inventory = { packages: [], environmentFiles: [] };
function visit(path) {
  const real = realpathSync(path);
  if (seen.has(real)) return;
  seen.add(real);
  if (statSync(real).isDirectory()) {
    for (const name of readdirSync(real)) visit(join(real, name));
    return;
  }
  const name = basename(real);
  if (name.startsWith('.env') && name !== '.env.example') {
    inventory.environmentFiles.push(real);
  }
  if (name === 'package.json') {
    const manifest = JSON.parse(readFileSync(real, 'utf8'));
    if (manifest.name && manifest.version) inventory.packages.push({ name: manifest.name, version: manifest.version });
  }
}
visit(root);
inventory.packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
inventory.environmentFiles.sort();
console.log(JSON.stringify(inventory));
