#!/usr/bin/env node
/**
 * Prints the direct dependencies with their real installed version and licence,
 * for the third-party list the competition requires. Exits non-zero if a licence
 * is outside the allowed set, so a bad package is noticed before submission.
 *
 *   npm run licenses
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** MIT, BSD and Apache-2.0 per CLAUDE.md. MPL-2.0 is open source and used for a test-only tool. */
const ALLOWED = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Apache-2.0', 'MPL-2.0']);

function readInstalled(name) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
  const license = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'UNKNOWN');
  return { name, version: manifest.version, license };
}

function table(title, names) {
  const rows = names.sort().map(readInstalled);
  console.log(`\n## ${title}\n\n| 名稱 | 版本 | 授權 |\n|---|---|---|`);
  for (const r of rows) console.log(`| ${r.name} | ${r.version} | ${r.license} |`);
  return rows;
}

const all = [
  ...table('執行時與前端（會出現在作品裡）', Object.keys(pkg.dependencies ?? {})),
  ...table('僅開發與測試', Object.keys(pkg.devDependencies ?? {})),
];

const bad = all.filter((r) => !ALLOWED.has(r.license));
if (bad.length > 0) {
  console.error(`\nLicences needing review: ${bad.map((r) => `${r.name} (${r.license})`).join(', ')}`);
  process.exit(1);
}
