import { readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'design/incoming/Fill with Eadwyn Page.dc.html',
  'design/incoming/Fill with Eadwyn · Boards.dc.html',
];

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">`;

for (const path of FILES) {
  let html = readFileSync(path, 'utf8');
  if (!/@font-face/.test(html)) {
    console.log(`${path}: no @font-face rules, skipped`);
    continue;
  }
  // Replace the first <style>...</style> block inside <helmet> when it contains @font-face.
  const replaced = html.replace(
    /(<helmet>[^]*?)<style>[^]*?@font-face[^]*?<\/style>/,
    `$1${FONTS}`,
  );
  if (replaced === html) {
    throw new Error(`${path}: could not find @font-face style block`);
  }
  writeFileSync(path, replaced);
  console.log(`${path}: replaced @font-face block with Google Fonts link`);
}
