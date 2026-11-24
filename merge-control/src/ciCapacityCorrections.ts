/** D7909: durable failure-correction notifications; scheduling hints never supply result or publication authority. */
import type { CapacityCompactFailedStore, CompactView } from './ciCapacityCompact.ts';
type Storage = Pick<DurableObjectStorage,'sql'>;
export class SqlCapacityCorrections {
  private storage:Storage;
  constructor(storage:Storage){
    this.storage=storage;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publication_corrections (seq INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE)');
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS capacity_correction_progress (
      name TEXT PRIMARY KEY CHECK(name IN ('due','failed-after','legacy-complete')), value TEXT NOT NULL)`);
  }
  enqueue(id:string):void{
    this.storage.sql.exec('INSERT OR IGNORE INTO capacity_publication_corrections(request_id) VALUES(?)',id);
  }
  clear(id:string):void{this.storage.sql.exec('DELETE FROM capacity_publication_corrections WHERE request_id=?',id);}
  remove(seq:number):void{this.storage.sql.exec('DELETE FROM capacity_publication_corrections WHERE seq=?',seq);}
  private get(name:string){return this.storage.sql.exec<{value:string}>('SELECT value FROM capacity_correction_progress WHERE name=?',name).toArray()[0]?.value;}
  private set(name:string,value:string){this.storage.sql.exec('INSERT OR REPLACE INTO capacity_correction_progress(name,value) VALUES(?,?)',name,value);}
  advance(seq:number):void{this.set('due',String(seq));}
  page():{seq:number;request_id:string}[]{
    const after=Number(this.get('due')??0);
    const read=(n:number)=>this.storage.sql.exec<{seq:number;request_id:string}>('SELECT seq,request_id FROM capacity_publication_corrections WHERE seq>? ORDER BY seq LIMIT 100',n).toArray();
    const rows=read(after);return rows.length||after===0?rows:read(0);
  }
  pending():boolean{return this.storage.sql.exec('SELECT seq FROM capacity_publication_corrections LIMIT 1').toArray().length>0;}
  legacyReady():boolean{return this.get('legacy-complete')==='yes';}
  finishLegacy():void{if(this.get('legacy-complete')==='scanned'&&!this.pending())this.completeLegacy();}
  completeLegacy():void{this.set('legacy-complete','yes');}
  /** At most one indexed page. Corrected failed records stay in this read and are filtered by the publisher. */
  discover(store:Partial<CapacityCompactFailedStore>,consider:(record:CompactView)=>void):boolean{
    if(typeof store.compactFailedPage!=='function')return false;
    const rows=store.compactFailedPage(this.get('failed-after')??'',100);
    for(const row of rows)consider(row);
    this.set('failed-after',rows.length===100?rows.at(-1)!.submission.requestId:'');
    if(rows.length<100&&!this.legacyReady())this.set('legacy-complete','scanned');
    return rows.length===100;
  }
}
