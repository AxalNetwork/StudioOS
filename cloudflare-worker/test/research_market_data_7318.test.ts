import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeIso3, normalizeValue, worldBankStatus, WORLD_BANK_METRICS } from '../src/services/researchMarketData.ts';

test('ISO matching rejects aggregates and malformed codes',()=>{ assert.equal(normalizeIso3('CHE'),'CHE'); assert.equal(normalizeIso3('ch'),null); assert.equal(normalizeIso3(''),null); });
test('missing provider values remain null, never zero',()=>{ assert.equal(normalizeValue(null),null); assert.equal(normalizeValue(''),null); assert.equal(normalizeValue(0),0); });
test('whitespace, booleans and objects are not measured zeroes',()=>{ for(const v of ['  ',false,true,{},[]]) assert.equal(normalizeValue(v),null); });
test('World Bank rows are not falsely labelled actual',()=>assert.equal(worldBankStatus(),'unspecified'));
test('required tier-1 baseline metrics are mapped',()=>{ for(const k of ['NY.GDP.MKTP.CD','NY.GDP.PCAP.CD','NY.GDP.MKTP.KD.ZG','FP.CPI.TOTL.ZG','SP.POP.TOTL','GC.DOD.TOTL.GD.ZS','BN.CAB.XOKA.GD.ZS']) assert.ok(k in WORLD_BANK_METRICS); });
