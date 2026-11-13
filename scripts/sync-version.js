#!/usr/bin/env node
// Copies the version from package.json into manifest.json so the two stay in
// sync. package.json is the single source of truth; this script is the one
// writer of manifest.json's "version" field.
//
// Runs automatically via the npm `version` lifecycle hook (see package.json),
// so `npm version patch|minor|major|2.3.0` bumps both files. Also runnable
// directly with `npm run sync-version`.
//
// Under the `version` hook it also stages manifest.json: npm commits only the
// files it changed itself (package.json, package-lock.json), so without this
// the version commit and tag ship without the manifest bump.
//
// The replacement is a targeted edit of the "version" line only, so the rest
// of manifest.json is preserved byte-for-byte (no JSON round-trip reformat).

const { readFileSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
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
  // Silent: the pre-commit hook runs this on every package.json/manifest.json
  // change, and "nothing to do" is the normal case there.
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

if (process.env.npm_lifecycle_event === 'version') {
  execFileSync('git', ['add', manifestPath], { cwd: root, stdio: 'inherit' });
}
