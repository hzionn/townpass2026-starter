import { readFile, mkdir, writeFile } from 'node:fs/promises';

// A single HTML asset avoids ES module / file-origin restrictions in WebViews.
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (/\b(?:src|href)=["'](?:\.\/)?assets\//.test(html)) {
  throw new Error('仍有外部建置資產，無法封裝成獨立 WebView 網頁。');
}
const target = new URL('../../TownPass/assets/carepass/', import.meta.url);
await mkdir(target, { recursive: true });
await writeFile(new URL('index.html', target), html);
console.log('已更新 TownPass/assets/carepass/index.html');
