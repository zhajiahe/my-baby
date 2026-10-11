import{readFileSync,writeFileSync}from'node:fs';import{testTargetGuard}from'./test-target-guard.js';
const {target,versionId}=testTargetGuard(),secret=JSON.parse(readFileSync('.migration/secrets.json','utf8'));const started=Date.now();
const response=await fetch(target.origin+'/api/ops/health',{headers:{authorization:`Bearer ${secret.MYBABY_OPERATIONS_TOKEN}`},signal:AbortSignal.timeout(30000)});
const body=await response.json() as {ok?:boolean;codeVersion?:string;deployment?:string;writesFrozen?:boolean;agentWritesEnabled?:boolean};
const report={observedAt:new Date().toISOString(),deploymentVersion:versionId,status:response.status,latencyMs:Date.now()-started,...body};
writeFileSync('.migration/monitor-latest.json',JSON.stringify(report,null,2),{mode:0o600});
console.log('Read-only isolated dependency probe:',report);
if(!response.ok||!body.ok)process.exitCode=1;
