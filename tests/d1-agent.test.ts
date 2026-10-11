import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {repository,type Database,type Statement,type SQLValue} from '../src/lib/d1-repository';
import {d1Store} from '../src/lib/agent/d1-store';
import {executeOperation} from '../src/lib/agent/service';
function harness(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('cloudflare/migrations/0001_initial.sql','utf8'));
 const pending=new WeakMap<Statement,()=>unknown>();
 const db:Database={prepare(sql){let values:SQLValue[]=[];const native=sqlite.prepare(sql);const stmt:Statement={
  bind(...v){values=v;return stmt;},async all<T>(){return {results:native.all(...values) as T[]};},
  async first<T>(){return (native.get(...values)??null) as T|null;},async run(){return native.run(...values);}};
  pending.set(stmt,()=>native.run(...values));return stmt;},async batch(statements){
   sqlite.exec('BEGIN');try{const result=statements.map(s=>pending.get(s)!());sqlite.exec('COMMIT');return result;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const repo=repository(db);return {db,repo,sqlite,store:d1Store(db)};
}
const grants=JSON.stringify([{source:'weixin',botId:'bot',userId:'allowed',babyId:'baby'}]);
const request={source:'weixin',botId:'bot',userId:'allowed',messageId:'msg',operationKey:'op_0',operation:'create_growth_record',args:{date:'2026-10-10',weight:10.5}};
async function setup(){const h=harness();await h.repo.baby.create({data:{id:'baby',name:'Synthetic',birthDate:new Date('2025-01-01'),gender:'boy'}});return h;}
test('D1 atomic batch: racing identical writes commit one receipt and one record',async()=>{
 const h=await setup();try{const options={store:h.store,grants,writesEnabled:true};
 const r=await Promise.all(Array.from({length:8},()=>executeOperation(request,options)));
 assert.equal(new Set(r.map(x=>x.data.id)).size,1);assert.equal(await h.repo.growthRecord.count(),1);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM agent_operations').get()!.n,1);
 await assert.rejects(executeOperation({...request,args:{...request.args,weight:12}},options),/idempotency_conflict/);
 }finally{h.sqlite.close();}
});
test('D1 late business failure rolls receipt back; retry succeeds',async()=>{
 const h=await setup();try{h.sqlite.exec("CREATE TRIGGER reject_write BEFORE INSERT ON growth_records BEGIN SELECT RAISE(ABORT,'injected'); END;");
 await assert.rejects(executeOperation(request,{store:h.store,grants,writesEnabled:true}));
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM agent_operations').get()!.n,0);
 h.sqlite.exec('DROP TRIGGER reject_write');await executeOperation(request,{store:h.store,grants,writesEnabled:true});
 assert.equal(await h.repo.growthRecord.count(),1);
 }finally{h.sqlite.close();}
});
test('D1 cached replay still enforces grants and write switch',async()=>{
 const h=await setup();try{await executeOperation(request,{store:h.store,grants,writesEnabled:true});
 await assert.rejects(executeOperation(request,{store:d1Store(h.db),grants:'[]',writesEnabled:true}));
 await assert.rejects(executeOperation(request,{store:h.store,grants,writesEnabled:false}));
 const r=await executeOperation(request,{store:d1Store(h.db),grants,writesEnabled:true});assert.equal(r.replayed,true);
 }finally{h.sqlite.close();}
});
test('D1 relational CRUD, JSON tags, UTC dates, atomic album batch and cascade',async()=>{
 const h=await setup();try{
 const m=await h.repo.milestone.create({data:{babyId:'baby',date:new Date('2026-10-10'),title:'Synthetic',tags:['one','two']}});
 assert.deepEqual((await h.repo.milestone.findUnique({where:{id:m.id}}))!.tags,['one','two']);
 await h.repo.milestone.update({where:{id:m.id},data:{tags:[]}});
 assert.deepEqual((await h.repo.milestone.findUnique({where:{id:m.id}}))!.tags,[]);
 const media={babyId:'baby',date:new Date(),title:'',url:'/api/media/uploads/test.jpg',mediaType:'IMAGE'};
 await assert.rejects(h.repo.createMediaBatch([media,{...media,babyId:'missing'}]));assert.equal(await h.repo.mediaItem.count(),0);
 await h.repo.createMediaBatch([media,media]);assert.equal((await h.repo.baby.findFirst({include:{_count:true}}))!._count.mediaItems,2);
 await h.repo.baby.delete({where:{id:'baby'}});assert.equal(await h.repo.mediaItem.count(),0);assert.equal(await h.repo.milestone.count(),0);
 }finally{h.sqlite.close();}
});
