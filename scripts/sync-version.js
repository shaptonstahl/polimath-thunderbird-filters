#!/usr/bin/env node
// Copies the version from package.json into manifest.json so the two stay in
// sync. package.json is the single source of truth; this script is the one
// writer of manifest.json's "version" field.
//
// Runs automatically via the npm `version` lifecycle hook (see package.json),
// so `npm version patch|minor|major|2.3.0` bumps both files. Also runnable
// directly with `npm run sync-version`.
//
// The replacement is a targeted edit of the "version" line only, so the rest
// of manifest.json is preserved byte-for-byte (no JSON round-trip reformat).

const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'manifest.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const manifestText = readFileSync(manifestPath, 'utf8');

let current;
try {
  current = JSON.parse(manifestText).version;
} catch {
  process.stderr.write('error: manifest.json is not valid JSON\n');
  process.exit(1);
}

if (current === pkg.version) {
  process.stderr.write(`manifest.json already at ${pkg.version}; nothing to do.\n`);
  return;
}

const updated = manifestText.replace(
  /^(\s*"version"\s*:\s*)"[^"]*"(\s*,?)[ \t]*$/m,
  (m, pre, post) => `${pre}${JSON.stringify(pkg.version)}${post}`,
);

if (updated === manifestText) {
  process.stderr.write('error: could not locate "version" field in manifest.json\n');
  process.exit(1);
}

writeFileSync(manifestPath, updated, 'utf8');
process.stderr.write(`manifest.json -> ${pkg.version}\n`);
