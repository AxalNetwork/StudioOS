/** #6185: isolated browser acceptance for the prepared component while Documents' file handoff waits. */
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepare } from './_editor.mjs';

let script, css;
test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl' },
    stdin: { resolveDir: root + 'frontend', sourcefile: 'room-search-6185-fixture.jsx', loader: 'jsx', contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import SharedRoomFiles from './src/pages/deal/SharedRoomFiles.jsx'; import { roomListing } from './src/pages/deal/dealWorkModel.js';
      const files=Array.from({length:60},(_,i)=>({uid:'f-'+i,name:i===0?'A'.repeat(140)+'.pdf':'File '+i+'.pdf',folder_uid:i<55?'a':'b',size_bytes:i*100,created_at:'2026-10-01T10:00:00Z'}));
      window.__opened=[];
      createRoot(document.getElementById('fixture')).render(<SharedRoomFiles projectUid="p-fixture" listing={roomListing({files,folders:[{uid:'a',name:'Finance'},{uid:'b',name:'Other'}]})} rawFiles={files} withheld={3} onDownload={f=>window.__opened.push(f.uid)} />);
    ` } });
  script = result.outputFiles[0].text;
  const name = readdirSync(root + 'docs/assets').find((name) => /^index-.*\.css$/.test(name));
  if (!name) throw new Error('Build the root before the room browser fixture.');
  css = readFileSync(root + 'docs/assets/' + name, 'utf8');
});

test('phone component keeps name search, sort and page while excluding extra content-search hits', async ({ page, request }) => {
  await prepare(page, request); await page.setViewportSize({ width: 390, height: 844 });
  let indexOff = true; const reads = [];
  await page.route('**/api/data-room/shared/p-fixture/search', route => {
    reads.push(route.request().postDataJSON());
    return route.fulfill({ json: indexOff ? { available: false } : { available: true, value: { hits: [
      { file_uid: 'f-0', file_name: 'Admitted file', snippet: 'Recorded snippet' },
      { file_uid: 'secret', file_name: 'Withheld name', snippet: 'Private snippet' }] } } });
  });
  await page.goto('/__visual/manifest');
  await page.setContent('<!doctype html><html class="dark"><body><main id="fixture"></main></body></html>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await expect(page.getByTestId('deal-room-file')).toHaveCount(25);
  expect(await page.getByTestId('deal-room-file').first().evaluate((row) => getComputedStyle(row).flexDirection)).toBe('column');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTestId('room-sort').selectOption('name'); await page.getByTestId('room-page-next').click();
  await expect(page.getByTestId('room-page-range')).toHaveText('26–50 of 60');
  await page.getByTestId('room-folder-a').click(); await expect(page.getByTestId('room-page-range')).toHaveText('26–50 of 55');
  await page.getByTestId('room-folder-b').click(); await expect(page.getByTestId('room-page-range')).toHaveText('1–5 of 5');
  await page.getByTestId('room-folder-all').click(); await expect(page.getByTestId('room-page-range')).toHaveText('26–50 of 60');
  await page.getByLabel('Search inside the files', { exact: true }).fill('cash'); await page.getByTestId('dataroom-search-go').click();
  await expect(page.getByTestId('dataroom-search-off')).toContainText('Search inside files is not switched on yet');
  await page.getByTestId('room-name-filter').fill('File 59.pdf'); await expect(page.getByTestId('room-page-range')).toHaveText('1–1 of 1');
  await page.getByTestId('room-name-filter').fill('no match'); await expect(page.getByTestId('deal-room-files')).toContainText('No file matches');
  indexOff = false; await page.getByTestId('dataroom-search-go').click();
  await expect(page.getByTestId('dataroom-search-hits')).toContainText('Recorded snippet');
  await expect(page.getByTestId('shared-room-files')).not.toContainText('Withheld name');
  await expect(page.getByTestId('shared-room-files')).not.toContainText('Private snippet');
  await page.getByRole('button', { name: 'Admitted file', exact: true }).click();
  expect(await page.evaluate(() => window.__opened)).toEqual(['f-0']);
  expect(reads).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId('deal-room-withheld')).toContainText('3 files need your NDA');
});
