import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewScore } from '../src/pages/DeckReviewerPage.jsx';
test('D895: a missing review score says so, while returned zero is a real score',()=>{
 const render=(score)=>renderToStaticMarkup(createElement(ReviewScore,{score}));
 assert.match(render(null),/Score not returned/);assert.doesNotMatch(render(null),/100|>0</);
 assert.match(render(undefined),/Score not returned/);
 assert.match(render(0),/>0</);assert.match(render(0),/100/);assert.doesNotMatch(render(0),/Score not returned/);
 assert.match(render(64),/>64</);
});
