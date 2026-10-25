import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CommitmentTotal } from '../src/pages/DealRoomPage.jsx';
test('aggregate-only commitment response renders its total without investor rows',()=>{
 const html=renderToStaticMarkup(createElement(CommitmentTotal,{total:3000}));
 assert.match(html,/Total committed/);assert.match(html,/3,000/);assert.doesNotMatch(html,/Investor|notes/);
 const source=readFileSync(new URL('../src/pages/DealRoomPage.jsx',import.meta.url),'utf8');
 assert.match(source,/if \(!Array.isArray\(items\)\) return <CommitmentTotal total=\{items.total\}/);
});
