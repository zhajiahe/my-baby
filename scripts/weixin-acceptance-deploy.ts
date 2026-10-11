import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {execFileSync} from 'node:child_process';import {randomBytes} from 'node:crypto';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),web=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
if(new URL(target.origin).hostname.split('.')[0]!=='mybaby-web-migration-test')throw new Error('isolated_target_required');
const fields:Record<string,string>={};for(const line of readFileSync('weixin/.env','utf8').split('\n')){if(line.startsWith('#')||!line.includes('='))continue;const i=line.indexOf('=');fields[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');}
if(!fields.OPENROUTER_API_KEY)throw new Error('model_key_missing');
const secretPath=resolve('.migration/weixin-acceptance-secrets.json');
let secrets:Record<string,string>;try{secrets=JSON.parse(readFileSync(secretPath,'utf8'));}catch{secrets={WEIXIN_ADMIN_TOKEN:randomBytes(32).toString('hex'),WEIXIN_BOT_TOKEN:'SYNTHETIC_ONLY_'+randomBytes(16).toString('hex')};}
secrets.OPENROUTER_API_KEY=fields.OPENROUTER_API_KEY;secrets.MYBABY_AGENT_TOKEN=web.MYBABY_AGENT_TOKEN;
writeFileSync(secretPath,JSON.stringify(secrets),{mode:0o600});
const url=new URL(target.origin);url.hostname=url.hostname.replace(/^mybaby-web-migration-test\./,'mybaby-weixin-acceptance.');
const origin=url.origin,env={...process.env,MYBABY_ACCEPTANCE_ORIGIN:target.origin,MYBABY_ACCEPTANCE_BRIDGE_ORIGIN:origin};
function run(command:string,args:string[]){try{return execFileSync(command,args,{cwd:'acceptance-weixin',env,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});}catch(e){const x=e as {stdout?:string;stderr?:string};writeFileSync('.migration/weixin-acceptance-deploy-error.log',String(x.stdout||'')+String(x.stderr||''),{mode:0o600});throw new Error('acceptance_deploy_failed_private_log');}}
const log=run('npx',['vite','build'])+run('cf',['deploy','--prebuilt','--secrets-file',secretPath]);
writeFileSync('.migration/weixin-acceptance-deploy.log',log,{mode:0o600});
writeFileSync('.migration/weixin-acceptance-target.json',JSON.stringify({origin,workerName:'mybaby-weixin-acceptance',queue:'mybaby-acceptance-inbox',dlq:'mybaby-acceptance-inbox-dlq'}),{mode:0o600});
console.log('Deployed separate synthetic acceptance Worker; no real Weixin credentials or current bridge bindings used.');
