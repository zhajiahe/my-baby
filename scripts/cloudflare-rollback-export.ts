// Read-only, frozen-target recovery snapshot. Never connects to or writes Neon.
import {readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {testTargetGuard} from './test-target-guard.js';
const production=process.argv.includes('--production');
const directory=production?'.migration-production':'.migration';
mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
const target=JSON.parse(readFileSync(`${directory}/target.json`,'utf8'));
const run=(args:string[])=>JSON.parse(execFileSync('cf',args,{encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));
let version;
if(production){
 const test=JSON.parse(readFileSync('.migration/target.json','utf8'));
 if(process.env.MYBABY_PRODUCTION_MIGRATION_APPROVED!=='standby-only'||target.workerName!=='mybaby-web-production'||target.bucketName!=='mybaby-production-media'||target.databaseId===test.databaseId)throw new Error('independent_approved_target_required');
 if(run(['d1','get',target.databaseId]).name!=='mybaby-production')throw new Error('production_database_identity_required');
 const d=run(['workers','deployments','list','--worker',target.workerName]).deployments[0];
 if(d?.versions?.length!==1||d.versions[0].percentage!==100)throw new Error('single_version_required');
 version=run(['workers','versions','get',d.versions[0].version_id,'--worker-id',target.workerName]);
}else{version=testTargetGuard().version;}
const b=version.bindings as {name:string;text?:string;database_id?:string;bucket_name?:string}[];
if(b.find(x=>x.name==='MYBABY_WRITES_FROZEN')?.text!=='true'||b.find(x=>x.name==='MYBABY_AGENT_WRITES_ENABLED')?.text!=='false'||b.find(x=>x.name==='DB')?.database_id!==target.databaseId||b.find(x=>x.name==='MEDIA')?.bucket_name!==target.bucketName)throw new Error('actual_frozen_bindings_required');
const tables=['deployment_guard','babies','growth_records','milestones','media_items','agent_operations','media_upload_receipts'];
const queryPath=`${directory}/rollback-query.json`;
writeFileSync(queryPath,JSON.stringify({batch:tables.map(table=>({sql:`SELECT * FROM ${table} ORDER BY id`.replace('deployment_guard ORDER BY id','deployment_guard ORDER BY name')}))}),{mode:0o600});
const data=run(['d1','query',target.databaseId,'--body',`@${queryPath}`]);
const rows=Object.fromEntries(tables.map((t,i)=>[t,data[i].results]));
if(rows.deployment_guard.find((r:{name:string})=>r.name==='environment')?.value!==(production?'mybaby-production':'mybaby-cloudflare-migration-test'))throw new Error('snapshot_guard_mismatch');
const snapshot={exportedAt:new Date().toISOString(),target:{workerName:target.workerName,databaseId:target.databaseId,bucketName:target.bucketName},rows};
const content=JSON.stringify(snapshot),sha256=createHash('sha256').update(content).digest('hex');
const path=`${directory}/rollback-${Date.now()}.json`;
writeFileSync(path,content,{mode:0o600});writeFileSync(`${path}.sha256`,sha256+'\n',{mode:0o600});
console.log('Frozen D1 snapshot saved privately, including both receipt ledgers. R2 remains preserved; this is NOT a verified Neon reverse import or permission to switch DNS.');
