import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';
export function testTargetGuard(){
 const target=JSON.parse(readFileSync('.migration/target.json','utf8'));
 if(target.workerName!=='mybaby-web-migration-test'||target.bucketName!=='mybaby-cloudflare-migration-test-media'||new URL(target.origin).hostname.split('.')[0]!==target.workerName)throw new Error('fixed_test_target_required');
 // Control-plane calls intermittently fail with a transport error; retry a
 // bounded number of times instead of reporting a false guard failure.
 const run=(args:string[])=>{let last:unknown;
  for(let attempt=0;attempt<5;attempt++){try{return JSON.parse(execFileSync('cf',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(error){last=error;}}
  throw last;};
 if(run(['d1','get',target.databaseId]).name!=='mybaby-cloudflare-migration-test')throw new Error('actual_test_database_required');
 const deployments=run(['workers','deployments','list','--worker',target.workerName]).deployments;
 const versionId=deployments[0]?.versions?.[0]?.version_id;
 if(!versionId||deployments[0].versions.length!==1||deployments[0].versions[0].percentage!==100)throw new Error('single_test_version_required');
 const version=run(['workers','versions','get',versionId,'--worker-id',target.workerName]);
 if(version.bindings.find((b:any)=>b.name==='MEDIA')?.bucket_name!==target.bucketName||version.bindings.find((b:any)=>b.name==='DB')?.database_id!==target.databaseId||version.bindings.some((b:any)=>b.name==='SOURCE_MEDIA'))throw new Error('actual_deployed_test_bindings_required');
 return{target,versionId,version};
}
