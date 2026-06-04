#!/usr/bin/env node
// Fetches Unicode confusables.txt and writes confusables-data.js.
// Usage: npm run build:confusables

const https = require('node:https');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const SOURCE = 'https://www.unicode.org/Public/security/latest/confusables.txt';
const OUT = path.join(__dirname, '..', 'confusables-data.js');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  process.stderr.write(`Fetching ${SOURCE} ...\n`);
  const text = await fetchText(SOURCE);

  let version = '';
  let date = '';
  const entries = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      const vm = line.match(/^#\s*Version:\s*(.+)/);
      if (vm) version = vm[1].trim();
      const dm = line.match(/^#\s*Date:\s*(.+)/);
      if (dm) date = dm[1].trim();
      continue;
    }

    // Format: source_hex(es) ; target_hex(es) ; type # comment
    const parts = line.split(';');
    if (parts.length < 2) continue;

    const srcHexes = parts[0].trim().split(/\s+/);
    const tgtHexes = parts[1].trim().split(/\s+/);

    // Skip multi-codepoint sources — sequence-level confusables are rare
    // and would require substring replacement rather than char-by-char mapping.
    if (srcHexes.length !== 1) continue;

    const srcCp = parseInt(srcHexes[0], 16);
    const srcStr = String.fromCodePoint(srcCp);
    const tgtStr = tgtHexes.map(h => String.fromCodePoint(parseInt(h, 16))).join('');

    // Skip self-mappings (source and target are identical).
    if (srcStr === tgtStr) continue;

    entries.push([srcCp, tgtStr]);
  }

  process.stderr.write(`Parsed ${entries.length} mappings (Version: ${version}, Date: ${date})\n`);

  const lines = entries.map(([cp, tgt]) => {
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    return `  [0x${hex}, ${JSON.stringify(tgt)}],`;
  });

  const output =
    `// Generated from Unicode confusables.txt Version: ${version}, Date: ${date}\n` +
    `// Do not edit — regenerate with: npm run build:confusables\n` +
    `self.CONFUSABLES_MAP = new Map([\n` +
    lines.join('\n') + '\n' +
    `]);\n`;

  writeFileSync(OUT, output, 'utf8');
  process.stderr.write(`Wrote ${OUT}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
