const NAME='neurolens2-research-v1';
export class Store {
  constructor(scope){this.scope=scope;}
  async open(){this.db=await new Promise((resolve,reject)=>{const req=indexedDB.open(NAME,1);req.onupgradeneeded=()=>req.result.createObjectStore('sessions',{keyPath:'key'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('다른 탭에서 저장소를 사용 중입니다.'));});}
  async operation(mode,fn){return new Promise((resolve,reject)=>{const tx=this.db.transaction('sessions',mode),r=fn(tx.objectStore('sessions'));let value;r.onsuccess=()=>value=r.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('저장 취소'));});}
  async put(packet){await this.operation('readwrite',s=>s.put({key:this.scope+':'+packet.id,scope:this.scope,packet}));}
  async list(){const rows=await this.operation('readonly',s=>s.getAll());return rows.filter(r=>r.scope===this.scope).map(r=>r.packet).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async remove(id){return this.operation('readwrite',s=>s.delete(this.scope+':'+id));}
  close(){this.db?.close();}
}
