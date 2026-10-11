import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const target=JSON.parse(readFileSync('.migration/target.json','utf8'));
if(target.workerName!=='mybaby-web-migration-test')throw new Error('test_target_required');
const call=(batch:unknown[])=>{writeFileSync('.migration/e2e-query.json',JSON.stringify({batch}),{mode:0o600});
 return JSON.parse(execFileSync('cf',['d1','query',target.databaseId,'--body','@.migration/e2e-query.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));};
const metadata=JSON.parse(execFileSync('cf',['d1','get',target.databaseId],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(metadata.name!=='mybaby-cloudflare-migration-test'||call([{sql:"SELECT value FROM deployment_guard WHERE name='environment'"}])[0].results[0].value!=='mybaby-cloudflare-migration-test')throw new Error('test_guard_required');
const now=new Date().toISOString();
call([...['media_upload_receipts','agent_operations','media_items','milestones','growth_records','babies'].map(table=>({sql:`DELETE FROM ${table}`})),
 {sql:'INSERT INTO babies(id,name,birthDate,gender,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',params:['e2e-baby','Synthetic E2E Baby','2025-01-01T00:00:00.000Z','boy',now,now]}]);
console.log('Guarded test D1 contains synthetic E2E data only; source Neon and legacy R2 untouched. Restore the private snapshot after testing.');
