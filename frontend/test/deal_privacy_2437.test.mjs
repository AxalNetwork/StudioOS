import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
// D1155: the total-only reply is drawn by the staff commitments table.
import { CommitmentTotal } from '../src/pages/deal/DealCommitmentsStaff.jsx';
test('aggregate-only commitment response renders its total without investor rows',()=>{
 const html=renderToStaticMarkup(createElement(CommitmentTotal,{total:3000}));
 assert.match(html,/Total committed/);assert.match(html,/3,000/);assert.doesNotMatch(html,/Investor|notes/);
 const source=readFileSync(new URL('../src/pages/deal/DealCommitmentsStaff.jsx',import.meta.url),'utf8');
 assert.match(source,/if \(!read\.items\) \{[\s\S]{0,240}<CommitmentTotal total=\{read\.total\} currency=\{currency\} \/>/);
});
