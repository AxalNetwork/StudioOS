import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {grantAttribution} from '../src/pages/raise/dataRoomRead.js';
test('2461: grants identify their granter and mark administrators', () => {
 assert.equal(grantAttribution({granted_by_name:'Synthetic Owner',granted_by_role:'founder'}),'Granted by Synthetic Owner (founder)');
 assert.equal(grantAttribution({granted_by_name:'Synthetic Staff',granted_by_role:'admin'}),'Granted by Synthetic Staff (admin)');
 assert.equal(grantAttribution({}),'Granted by Not recorded');
 // D1109 (#2989): the old files tool is retired; the tool's grant rows carry the attribution.
 const model=readFileSync(new URL('../src/pages/raise/dataroom/dataRoomModel.js',import.meta.url),'utf8');
 assert.match(model,/by: grantAttribution\(g\)/);
 const access=readFileSync(new URL('../src/pages/raise/dataroom/DataRoomAccess.jsx',import.meta.url),'utf8');
 assert.ok(access.includes('If ${chosen.email} has a StudioOS account'), 'the share line claims access it cannot know');
});
