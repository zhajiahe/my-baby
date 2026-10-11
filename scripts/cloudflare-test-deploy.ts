import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';import {codeVersion} from './code-version.js';
const dir='.migration',target=JSON.parse(readFileSync(`${dir}/target.json`,'utf8'));
if(target.workerName!=='mybaby-web-migration-test'||target.bucketName!=='mybaby-cloudflare-migration-test-media'||!target.sourceBucket||target.sourceBucket===target.bucketName)throw new Error('isolated_target_required');
function run(command:string,args:string[],env:NodeJS.ProcessEnv=process.env){
 try{return execFileSync(command,args,{env,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});}
 catch(error){const e=error as {stdout?:string;stderr?:string};
  writeFileSync(`${dir}/deploy-failure.log`,String(e.stdout||'')+String(e.stderr||''),{mode:0o600});
  throw new Error('test_deploy_failed_private_values_not_logged');}}
const database=JSON.parse(run('cf',['d1','get',target.databaseId]));
if(database.name!=='mybaby-cloudflare-migration-test')throw new Error('unexpected_d1_name');
const secrets=JSON.parse(readFileSync(`${dir}/secrets.json`,'utf8'));
if(!secrets.MYBABY_OPERATIONS_TOKEN){secrets.MYBABY_OPERATIONS_TOKEN=randomBytes(32).toString('hex');writeFileSync(`${dir}/secrets.json`,JSON.stringify(secrets),{mode:0o600});}
const version=codeVersion();writeFileSync(`${dir}/code-version.json`,JSON.stringify(version),{mode:0o600});
const env={...process.env,MYBABY_CODE_VERSION:version.version,MYBABY_TEST_WRITES_FROZEN:process.argv.includes('--freeze-writes')?'true':'false',MYBABY_SOURCE_BUCKET:process.argv.includes('--without-source-media')?'':target.sourceBucket,MYBABY_R2_ACCOUNT_ID:target.accountId,MYBABY_D1_TEST_ID:target.databaseId,
 MYBABY_TEST_AGENT_GRANTS:(process.argv.includes('--agent-test')||process.argv.includes('--synthetic-agent'))?JSON.stringify([{source:'weixin',botId:'cloud-migration-test-bot',
 userId:'cloud-migration-test-user',babyId:process.argv.includes('--synthetic-agent')?'e2e-baby':JSON.parse(readFileSync(`${dir}/source.json`,'utf8')).rows.babies[0].id}]):''};
let log=run('npx',['vinext','build'],env);
log+=run('cf',['deploy','--prebuilt','--provision=false','--secrets-file',`${dir}/secrets.json`],env);
writeFileSync(`${dir}/deploy.log`,log,{mode:0o600});chmodSync(`${dir}/deploy.log`,0o600);
const origin=log.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/)?.[0];
if(!origin||new URL(origin).hostname.split('.')[0]!==target.workerName)throw new Error('unexpected_deployed_origin');
target.origin=origin;writeFileSync(`${dir}/target.json`,JSON.stringify(target),{mode:0o600});
console.log('Isolated Web Worker built and deployed:',origin);
