import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import { isDialablePhone } from '../src/domain/phone.ts';

export const DISTRICTS = ['松山區', '信義區', '大安區', '中山區', '中正區', '大同區', '萬華區', '文山區', '南港區', '內湖區', '士林區', '北投區'];
export function parseArea(raw) {
  const normalized = raw.replace(/[\s,，、及和與；;]/g, '');
  const districts = DISTRICTS.filter(d => normalized.includes(d));
  const remainder = districts.reduce((text, d) => text.replaceAll(d, ''), normalized);
  return { districts, scopeStatus: districts.length && !remainder ? 'explicit' : 'needs-confirmation' };
}

export function convertCsv(bytes) {
  const csv = new TextDecoder('big5', { fatal: true }).decode(bytes);
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, trim: true });
  if (!rows.length) throw new Error('來源沒有資料，保留既有快照。');
  for (const column of ['序號', '機構名稱', '服務區別', '機構（服務）地址', '市話', '居家式喘息服務特約']) {
    if (!(column in rows[0])) throw new Error(`缺少必要欄位：${column}`);
  }
  const issues = [];
  const providers = rows.map((r, index) => {
    if (!r['機構名稱'] || !r['居家式喘息服務特約']) throw new Error(`第 ${index + 1} 列缺少名稱或喘息特約代碼。`);
    const area = parseArea(r['服務區別']);
    if (area.scopeStatus !== 'explicit') issues.push({ row: r['序號'], kind: '服務範圍待確認', original: r['服務區別'] });
    if (!r['市話'] && !r['行動電話']) issues.push({ row: r['序號'], kind: '電話缺漏' });
    else if (!isDialablePhone(r['市話'] || r['行動電話'])) issues.push({ row: r['序號'], kind: '電話格式待確認', original: r['市話'] || r['行動電話'] });
    if (/停業|暫停|停約/.test(r['機構名稱'])) issues.push({ row: r['序號'], kind: '來源服務狀態註記待確認', original: r['機構名稱'] });
    const identity = [r['機構名稱'], r['機構（服務）地址'], r['市話']].join('|');
    return { id: `home-${createHash('sha256').update(identity).digest('hex').slice(0, 14)}`, name: r['機構名稱'], address: r['機構（服務）地址'], phone: r['市話'] || r['行動電話'] || '', extension: r['分機'] || '', mobile: r['行動電話'] || '', serviceAreaRaw: r['服務區別'], ...area, respiteCode: r['居家式喘息服務特約'], shortCareCode: r['居家式短照服務特約'] || '', sourceRowId: r['序號'] };
  });
  const unique = new Map();
  for (const p of providers) {
    if (unique.has(p.id)) throw new Error(`疑似重複單位：${p.name}，需檢查後再更新。`);
    unique.set(p.id, p);
  }
  providers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return { providers, issues, rawCount: rows.length };
}

async function main() {
  const source = JSON.parse(await readFile(new URL('../data/source.json', import.meta.url), 'utf8'));
  const bytes = await readFile(new URL('../data/home.csv', import.meta.url));
  const result = convertCsv(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const snapshot = { source: { ...source, sha256, version: sha256.slice(0, 12), rawCount: result.rawCount, outputCount: result.providers.length, confirmedAreaCount: result.providers.filter(p => p.scopeStatus === 'explicit').length, pendingAreaCount: result.providers.filter(p => p.scopeStatus !== 'explicit').length }, providers: result.providers };
  const output = new URL('../src/data/providers.json', import.meta.url);
  await mkdir(dirname(output.pathname), { recursive: true });
  const temporary = new URL('../src/data/providers.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(temporary, output);
  await writeFile(new URL('../data/import-report.json', import.meta.url), JSON.stringify({ sha256, rawCount: result.rawCount, outputCount: result.providers.length, issues: result.issues }, null, 2) + '\n');
  console.log(`已整理 ${result.providers.length} 筆官方資料；${snapshot.source.pendingAreaCount} 筆服務範圍待確認。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
