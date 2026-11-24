/** D7909: canonical, authenticated supervisor results; no raw logs, tokens or candidate artifacts. */
import type { CapacityExecutionResult } from '../ciCapacityGithub.ts';
import type { ExecutionReceipt } from './ciCapacityPolicy.ts';
import { receiptMatches } from './ciCapacityPolicy.ts';
import { pruneCapacityHistory } from '../ciCapacityHistory.ts';
import { SqlCapacityCorrections } from '../ciCapacityCorrections.ts';
export type ExecutionResultBody = Pick<CapacityExecutionResult,'testStep'|'executionOutcome'|'cleanupConfirmed'> & { exportComplete: boolean };
export function executionResultBody(value: unknown): ExecutionResultBody {
  const row=value as ExecutionResultBody|null;
  if(!row||!['success','failure','not_run','unknown'].includes(row.testStep)
    ||!['completed','setup_failure','timed_out','cleanup_failure','export_failure','unknown'].includes(row.executionOutcome)
    ||typeof row.cleanupConfirmed!=='boolean'||typeof row.exportComplete!=='boolean')throw new Error('capacity_result_shape');
  return {testStep:row.testStep,executionOutcome:row.executionOutcome,cleanupConfirmed:row.cleanupConfirmed,exportComplete:row.exportComplete};
}
type StoredResult = CapacityExecutionResult & { receivedAt: number; failureApplied?: boolean };
function storedResult(text:string):StoredResult{
  const value=JSON.parse(text) as StoredResult;executionResultBody(value);
  if(!value.receipt||typeof value.receipt.requestId!=='string'||!Number.isSafeInteger(value.jobId)||value.jobId<=0
    ||!Number.isSafeInteger(value.receivedAt))throw new Error('capacity_result_state');return value;
}
export class SqlCapacityResults {
  private storage: Pick<DurableObjectStorage,'sql'|'transactionSync'>;
  private corrections:SqlCapacityCorrections;
  constructor(storage: Pick<DurableObjectStorage,'sql'|'transactionSync'>){
    this.storage=storage;this.corrections=new SqlCapacityCorrections(storage);
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_execution_results (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, state TEXT NOT NULL)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS capacity_execution_result_owner ON capacity_execution_results(request_id,id)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_failure_scan_cursor (id INTEGER PRIMARY KEY CHECK(id=1), last TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_result_failures (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, state TEXT NOT NULL)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS capacity_result_failures_owner ON capacity_result_failures(request_id,id)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_failure_cursor (id INTEGER PRIMARY KEY CHECK(id=1), last TEXT NOT NULL)');
  }
  private id(receipt: ExecutionReceipt){return `${receipt.requestId}:${receipt.logicalShard}:${receipt.generation}:${receipt.childRunId}`;}
  pendingFailure(id:string):boolean{
    const pending=this.storage.sql.exec<{id:string;state:string}>('SELECT id,state FROM capacity_result_failures WHERE request_id=? LIMIT 1',id).toArray()[0];
    if(pending){const value=storedResult(pending.state);
      if(value.testStep!=='failure'||value.receipt.requestId!==id||this.id(value.receipt)!==pending.id)throw new Error('capacity_result_state');return true;}
    // Legacy negatives fence retention before their bounded recovery scan reaches them; unreadable rows refuse.
    const rows=this.storage.sql.exec<{id:string;state:string}>('SELECT id,state FROM capacity_execution_results WHERE request_id=? LIMIT 19',id).toArray();
    if(rows.length>18)throw new Error('capacity_result_history_bound');
    for(const row of rows){const value=storedResult(row.state);
      if(value.receipt.requestId!==id||this.id(value.receipt)!==row.id)throw new Error('capacity_result_state');
      if(value.testStep==='failure'&&value.failureApplied!==true)return true;
    }return false;
  }
  private recoverFailures():boolean{
    return this.storage.transactionSync(()=>{
    const last=this.storage.sql.exec<{last:string}>('SELECT last FROM capacity_failure_scan_cursor WHERE id=1').toArray()[0]?.last??'';
    const rows=this.storage.sql.exec<{id:string;request_id:string;state:string}>('SELECT id,request_id,state FROM capacity_execution_results WHERE id>? ORDER BY id LIMIT 64',last).toArray();
    for(const row of rows){
      this.storage.sql.exec('INSERT OR REPLACE INTO capacity_failure_scan_cursor(id,last) VALUES(1,?)',row.id);
      try{const value=storedResult(row.state);
        if(value.receipt.requestId!==row.request_id||this.id(value.receipt)!==row.id)throw new Error('capacity_result_state');
        if(value.testStep==='failure'&&value.failureApplied!==true){
          this.storage.sql.exec('INSERT OR IGNORE INTO capacity_result_failures(id,request_id,state) VALUES(?,?,?)',row.id,row.request_id,row.state);
          this.corrections.enqueue(row.request_id);
        }
      }catch{/* Retain unreadable evidence while the cursor lets other records progress. */}
    }
    if(rows.length<64)this.storage.sql.exec('DELETE FROM capacity_failure_scan_cursor WHERE id=1');
    else this.storage.sql.exec('INSERT OR REPLACE INTO capacity_failure_scan_cursor(id,last) VALUES(1,?)',rows.at(-1)!.id);
    return rows.length===64;
    });
  }
  /** Authenticated write-ahead negatives survive a crash before coordinator application. */
  async replayFailures(apply:(receipt:ExecutionReceipt,jobId:number)=>Promise<void>):Promise<boolean>{
    const last=this.storage.sql.exec<{last:string}>('SELECT last FROM capacity_failure_cursor WHERE id=1').toArray()[0]?.last??'';
    const rows=this.storage.sql.exec<{id:string;state:string}>('SELECT id,state FROM capacity_result_failures WHERE id>? ORDER BY id LIMIT 64',last).toArray();
    for(const row of rows){
      this.storage.sql.exec('INSERT OR REPLACE INTO capacity_failure_cursor(id,last) VALUES(1,?)',row.id);
      try{const value=storedResult(row.state);
        if(value.testStep!=='failure'||this.id(value.receipt)!==row.id)throw new Error('capacity_result_state');
        this.validate(value.receipt,value.jobId);await apply(value.receipt,value.jobId);this.appliedFailure(value.receipt,value.jobId);
      }catch{/* Keep uncertain ownership/negative truth, but let the cursor reach other records. */}
    }
    if(rows.length<64)this.storage.sql.exec('DELETE FROM capacity_failure_cursor WHERE id=1');
    return this.storage.sql.exec('SELECT id FROM capacity_result_failures LIMIT 1').toArray().length>0;
  }
  appliedFailure(receipt:ExecutionReceipt,jobId:number):void{
    this.storage.transactionSync(()=>{
      this.validate(receipt,jobId);
      const row=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_execution_results WHERE id=?',this.id(receipt)).toArray()[0];
      if(!row)throw new Error('capacity_result_state');const value=storedResult(row.state);
      if(value.testStep!=='failure')throw new Error('capacity_result_state');
      this.storage.sql.exec('UPDATE capacity_execution_results SET state=? WHERE id=?',JSON.stringify({...value,failureApplied:true}),this.id(receipt));
      this.corrections.enqueue(receipt.requestId);
      this.storage.sql.exec('DELETE FROM capacity_result_failures WHERE id=?',this.id(receipt));
    });
  }
  prune():boolean{const scan=this.recoverFailures();const history=pruneCapacityHistory(this.storage,'results');return scan||history||this.storage.sql.exec('SELECT id FROM capacity_result_failures LIMIT 1').toArray().length>0;}
  /** Verify the immutable association before any sticky update or acknowledgement. */
  validate(receipt:ExecutionReceipt,jobId:number):void{
    const old=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_execution_results WHERE id=?',this.id(receipt)).toArray()[0];
    if(old){const previous=storedResult(old.state);
      if(!receiptMatches(previous.receipt,receipt)||previous.jobId!==jobId)throw new Error('capacity_result_conflict');}
  }
  put(receipt: ExecutionReceipt,jobId: number,value: ExecutionResultBody,now: number):void {
    this.prune();
    this.storage.transactionSync(()=>{
      this.validate(receipt,jobId);
      const id=this.id(receipt),old=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_execution_results WHERE id = ?',id).toArray()[0];
      const previous=old?JSON.parse(old.state) as StoredResult:null;
      if(previous&&(!receiptMatches(previous.receipt,receipt)||previous.jobId!==jobId))throw new Error('capacity_result_conflict');
      // Negative truth is sticky. Cleanup remains independently reported and cannot erase it.
      const record: StoredResult={receipt,jobId,...value,testStep:previous?.testStep==='failure'?'failure':value.testStep,receivedAt:now,observedAt:now,failureApplied:false};
      this.storage.sql.exec('INSERT INTO capacity_execution_results (id,request_id,state) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state = excluded.state',id,receipt.requestId,JSON.stringify(record));
      if(record.testStep==='failure'){
        this.storage.sql.exec('INSERT INTO capacity_result_failures(id,request_id,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',id,receipt.requestId,JSON.stringify(record));
        this.corrections.enqueue(receipt.requestId);
      }
    });
  }
  read(receipt: ExecutionReceipt,jobId: number,now: number):CapacityExecutionResult|null {
    const row=this.storage.sql.exec<{state:string}>('SELECT state FROM capacity_execution_results WHERE id = ?',this.id(receipt)).toArray()[0];
    if(!row)return null;
    const value=storedResult(row.state);
    if(!value||!receiptMatches(value.receipt,receipt)||value.jobId!==jobId||!Number.isSafeInteger(value.receivedAt)||value.receivedAt>now)throw new Error('capacity_result_state');
    executionResultBody(value);
    // Fresh authority read of immutable job-bound evidence; receivedAt is retained separately, not rewritten.
    return {...value,observedAt:now};
  }
}
