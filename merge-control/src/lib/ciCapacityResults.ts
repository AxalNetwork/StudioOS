/** D7909: canonical, authenticated supervisor results; no raw logs, tokens or candidate artifacts. */
import type { CapacityExecutionResult } from '../ciCapacityGithub.ts';
import type { ExecutionReceipt } from './ciCapacityPolicy.ts';
import { receiptMatches } from './ciCapacityPolicy.ts';
export type ExecutionResultBody = Pick<CapacityExecutionResult,'testStep'|'executionOutcome'|'cleanupConfirmed'> & { exportComplete: boolean };
export function executionResultBody(value: unknown): ExecutionResultBody {
  const row=value as ExecutionResultBody|null;
  if(!row||!['success','failure','not_run','unknown'].includes(row.testStep)
    ||!['completed','setup_failure','timed_out','cleanup_failure','export_failure','unknown'].includes(row.executionOutcome)
    ||typeof row.cleanupConfirmed!=='boolean'||typeof row.exportComplete!=='boolean')throw new Error('capacity_result_shape');
  return {testStep:row.testStep,executionOutcome:row.executionOutcome,cleanupConfirmed:row.cleanupConfirmed,exportComplete:row.exportComplete};
}
type StoredResult = CapacityExecutionResult & { receivedAt: number };
export class SqlCapacityResults {
  private storage: Pick<DurableObjectStorage,'sql'|'transactionSync'>;
  constructor(storage: Pick<DurableObjectStorage,'sql'|'transactionSync'>){
    this.storage=storage;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_execution_results (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, state TEXT NOT NULL)');
  }
  private id(receipt: ExecutionReceipt){return `${receipt.requestId}:${receipt.logicalShard}:${receipt.generation}:${receipt.childRunId}`;}
  put(receipt: ExecutionReceipt,jobId: number,value: ExecutionResultBody,now: number):void {
    this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM capacity_execution_results WHERE request_id NOT IN (SELECT id FROM ci_capacity_requests)');
      const id=this.id(receipt),old=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_execution_results WHERE id = ?',id).toArray()[0];
      const previous=old?JSON.parse(old.state) as StoredResult:null;
      if(previous&&(!receiptMatches(previous.receipt,receipt)||previous.jobId!==jobId))throw new Error('capacity_result_conflict');
      // Negative truth is sticky. Cleanup remains independently reported and cannot erase it.
      const record: StoredResult={receipt,jobId,...value,testStep:previous?.testStep==='failure'?'failure':value.testStep,receivedAt:now,observedAt:now};
      this.storage.sql.exec('INSERT INTO capacity_execution_results (id,request_id,state) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state = excluded.state',id,receipt.requestId,JSON.stringify(record));
    });
  }
  read(receipt: ExecutionReceipt,jobId: number,now: number):CapacityExecutionResult|null {
    const row=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_execution_results WHERE id = ?',this.id(receipt)).toArray()[0];
    if(!row)return null;
    const value=JSON.parse(row.state) as StoredResult;
    if(!value||!receiptMatches(value.receipt,receipt)||value.jobId!==jobId||!Number.isSafeInteger(value.receivedAt)||value.receivedAt>now)throw new Error('capacity_result_state');
    executionResultBody(value);
    // Fresh authority read of immutable job-bound evidence; receivedAt is retained separately, not rewritten.
    return {...value,observedAt:now};
  }
}
