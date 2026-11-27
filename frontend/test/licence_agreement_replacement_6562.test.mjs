/** D6562: rendered L09/L10 readiness, honest comparisons, frozen text and send gating. Synthetic documents only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AgreementReplacement, AgreementTermsComparison, agreementCanSend } from '../src/pages/admin/licences/AgreementReplacement.jsx';
const keys=['legal_entity','territory','commercial_terms','governing_law','signatory_title'];
const readiness={ready:true,fields:keys.map(key=>({key,state:'ready'}))};
const current={status:'draft',snapshot_recorded:true,readiness,body_md:'Frozen <script>synthetic</script> agreement',body_sha256:'a'.repeat(64),unfilled_fields:[]};
const render=(C,p)=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(C,p)));
test('comparison uses only recorded differences and keeps absent comparison unknown',()=>{
 const unknown=render(AgreementTermsComparison,{reason:'Legacy has no snapshot'});assert.match(unknown,/Not recorded/);assert.match(unknown,/Legacy has no snapshot/);assert.doesNotMatch(unknown,/match the executed|Prepare replacement/);
 const same=render(AgreementTermsComparison,{comparison:{differs:false,changed_terms:0}});assert.match(same,/match the executed/);assert.doesNotMatch(same,/Prepare replacement/);
 const different=render(AgreementTermsComparison,{comparison:{differs:true,changed_terms:2},executedVersion:'v4',disabled:true});assert.match(different,/Current terms differ from Agreement v4/);assert.match(different,/2 contractual terms changed/);assert.match(different,/disabled=""[^>]*>Prepare replacement/);
});
test('all five rows are ready, the full hash and escaped frozen text are visible, and prior executed agreement remains',()=>{
 const html=render(AgreementReplacement,{licenceUid:'unit',current,readiness,agreementVersion:'v5',executedVersion:'v4'});
 assert.equal((html.match(/>Ready</g)||[]).length,5);assert.match(html,/Exactly what will be sent/);assert.match(html,/a{64}/);assert.match(html,/Frozen &lt;script&gt;synthetic&lt;\/script&gt; agreement/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Until v5 is executed, v4 stays the executed agreement/);assert.equal(agreementCanSend(current,readiness),true);
});
test('each missing readiness field has Fix in Terms and disables send, while missing snapshot/text/hash and sent documents never send',()=>{
 for(const key of keys){const missing={ready:false,fields:readiness.fields.map(f=>f.key===key?{...f,state:'not_recorded'}:f)};const html=render(AgreementReplacement,{licenceUid:'unit',current,readiness:missing});assert.match(html,/Not recorded/);assert.match(html,/Fix in Terms/);assert.match(html,/licence=unit&amp;tab=terms/);assert.equal(agreementCanSend(current,missing),false);assert.equal(agreementCanSend(current,{...missing,ready:true}),false);assert.equal(agreementCanSend({...current,readiness:missing},readiness),false);}
 for(const patch of [{snapshot_recorded:false},{body_md:null},{body_sha256:null},{envelope_uid:'env'},{status:'sent'},{unfilled_fields:['missing']}])assert.equal(agreementCanSend({...current,...patch},readiness),false);
 assert.equal(render(AgreementReplacement,{current:{...current,status:'signed'},readiness}),'');
 const legacy=render(AgreementReplacement,{current:{...current,body_md:null},readiness});assert.match(legacy,/frozen text and its hash are unavailable/);assert.doesNotMatch(legacy,/Exactly what will be sent<\/h3>.*<pre/);
});
