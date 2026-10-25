import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {grantAttribution} from '../src/pages/raise/dataRoomRead.js';
test('2461: grants identify their granter and mark administrators', () => {
 assert.equal(grantAttribution({granted_by_name:'Synthetic Owner',granted_by_role:'founder'}),'Granted by Synthetic Owner (founder)');
 assert.equal(grantAttribution({granted_by_name:'Synthetic Staff',granted_by_role:'admin'}),'Granted by Synthetic Staff (admin)');
 assert.equal(grantAttribution({}),'Granted by Not recorded');
 const page=readFileSync(new URL('../src/pages/raise/DataRoomPage.jsx',import.meta.url),'utf8');
 assert.match(page,/grantAttribution\(g\)/);
 assert.ok(page.includes('If this address has an account, it now has access'));
});
