import{readFileSync,writeFileSync}from'node:fs';import{testTargetGuard}from'./test-target-guard.js';
const {target}=testTargetGuard(),secrets=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
const baseline=JSON.parse(readFileSync('.migration/media-report.json','utf8')) as {key:string;verified:boolean}[];
if(!baseline.length||baseline.some(r=>!r.verified))throw new Error('verified_original_copy_manifest_required');
// The copy route lands source keys under the private `legacy/` prefix; keep the
// real target keys, never the bare source keys from the report.
const keepKeys=baseline.map(r=>'legacy/'+r.key);
async function call(dryRun:boolean,candidateHash?:string){let last:unknown;
 for(let attempt=0;attempt<5;attempt++){try{
  const response=await fetch(target.origin+'/api/migration/cleanup-test-media',{method:'POST',headers:{authorization:`Bearer ${secrets.MIGRATION_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({keepKeys,dryRun,candidateHash}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('cleanup_failed');return response.json() as Promise<{candidateHash:string;candidates:number;bytes:number}>;
 }catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,4000));}}
 throw last;}
const preview=await call(true);const execute=process.argv.includes('--execute');const result=execute?await call(false,preview.candidateHash):preview;
if(result.candidateHash!==preview.candidateHash)throw new Error('cleanup_manifest_changed');
writeFileSync('.migration/media-cleanup-report.json',JSON.stringify({finishedAt:new Date().toISOString(),execute,preview,result}),{mode:0o600});
console.log('Guarded test-only media cleanup:',{execute,candidates:result.candidates,bytes:result.bytes,keptVerifiedReferences:keepKeys.length});
