/** #6315: idempotent PostHog retries must never acquire delete permission for pre-existing feedback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,appFor,call,FOUNDER,P,PH} from './_posthog_cycle_fixture.ts';
import growRouter from '../src/routes/cycle_grow.ts';

test('accepting a pending retry links historical edited feedback; source-specific undo preserves it',async()=>{
 const {db,env,fake}=await fixture();const app=appFor(fake);app.route('/api/cycles/grow',growRouter);
 try{
  const made=db.prepare("INSERT INTO posthog_proposals(integration_id,project_id,module,kind,source_key,payload_json) VALUES(?,?,'product_improvement','survey_feedback','retry-fixture',?)").run(PH,P,JSON.stringify({answer:'Original survey answer'}));
  const id=Number(made.lastInsertRowid),uid=`posthog-proposal-${id}`;
  // This edited record can predate the revision migration, so version zero is
  // not evidence that this request created it. The source proposal is pending.
  db.prepare("INSERT INTO product_feedback(uid,project_id,body,source,created_by,updated_by) VALUES(?,?,?,'customer',?,?)").run(uid,P,'Already edited historical feedback',FOUNDER,FOUNDER);
  const accepted=await call(app,env,FOUNDER,'POST',`/api/cycles/grow/posthog/proposals/${id}/accept`,{project:P});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  const receipt=accepted.body.destination;assert.equal(receipt.created_record,false);
  assert.match(receipt.href,new RegExp(`/product-improvement/${uid}\\?project_id=${P}$`));
  const undone=await call(app,env,FOUNDER,'POST',`/api/cycles/grow/posthog/proposals/${id}/undo`,{project:P,receipt_uid:receipt.uid});
  assert.equal(undone.status,200,JSON.stringify(undone.body));
  assert.equal((db.prepare('SELECT body FROM product_feedback WHERE uid=?').get(uid) as any).body,'Already edited historical feedback');
  assert.equal((db.prepare('SELECT status FROM posthog_proposals WHERE id=?').get(id) as any).status,'pending');
  assert.ok(db.prepare("SELECT 1 FROM activity_logs WHERE action='grow_proposal_undone' AND user_id=? AND actor=?").get(FOUNDER,`user:${FOUNDER}`));
 }finally{db.close();}
});
