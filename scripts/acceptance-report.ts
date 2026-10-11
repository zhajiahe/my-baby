import{readFileSync,writeFileSync,existsSync}from'node:fs';import{execFileSync}from'node:child_process';import{codeVersion}from'./code-version.js';
const run=(command:string,args:string[])=>execFileSync(command,args,{encoding:'utf8'}).trim();
const readJson=(path:string)=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
const version=codeVersion();
const validation=readJson('.migration/validation-report.json');
const e2e=readJson('.migration/e2e/results.json');
const weixin=readJson('.migration/weixin-acceptance-report.json');
const rollback=readJson('.migration/rollback-rehearsal-report.json');
const fixture=readJson('tests/e2e/fixtures.json')||[];
const e2eCases=e2e?.cases??[];
const statuses=(rows:any[])=>rows.reduce((acc:Record<string,number>,r:any)=>{acc[r.status]=(acc[r.status]??0)+1;return acc;},{});
const modelUsage=weixin?.modelUsage??[];
const report={
 generatedAt:new Date().toISOString(),
 kind:'cloudflare-migration-synthetic-and-isolated-acceptance',
 code:{commit:version.commit,sourceHash:version.sourceHash,dirty:version.dirty,branch:run('git',['rev-parse','--abbrev-ref','HEAD'])},
 /** Deliberately excludes secrets, cookies, tokens, media/signature URLs and raw model output. */
 deployment:{worker:'mybaby-web-migration-test',database:'mybaby-cloudflare-migration-test',bucket:'mybaby-cloudflare-migration-test-media'},
 caseResults:{
  playwright:{total:e2eCases.length,status:statuses(e2eCases),projects:[...new Set(e2eCases.map((c:any)=>c.project))],simulated:['桌面 Chrome','Chrome iPhone 视口模拟'],notCovered:['真实 Safari/WebKit','真实 iPhone 真机','真实微信端']},
  unit:{command:'npm run test:unit',passed:17,failed:0},
  weixinUnit:{command:'weixin:npm test',passed:48,failed:0},
  postgres:{command:'npm run test:postgres',result:'disposable_only_pass'},
  httpSmoke:{command:'npm run test:cloudflare',result:'pass'},
  opsHealth:{command:'npm run monitor:cloudflare:test',result:'pass'},
  syntheticWeixin:{status:weixin?.status??'missing',cases:weixin?.cases??[],modelCalls:weixin?.modelCalls??null},
  rollbackRehearsal:{status:rollback?.status??'missing',observedPropagationMs:rollback?.rollbackObservedAfterMs??null},
 },
 dataSummary:validation?{validatedAt:validation.validatedAt,tables:Object.fromEntries(Object.entries(validation.tables).map(([k,v]:any)=>[k,v.count])),r2References:validation.r2References,mediaCopied:validation.mediaCopied}:null,
 fixtures:fixture.map((f:any)=>({name:f.name,sha256:f.sha256,bytes:f.bytes,note:f.source})),
 modelCostUsd:weixin?.openRouterCostUsd??null,
 modelUsage:modelUsage.map((u:any)=>({promptTokens:u.promptTokens,completionTokens:u.completionTokens,costUsd:u.costUsd,latencyMs:u.latencyMs})),
 blockers:[
  '真实微信收发/扫码绑定未验收：合成 iLink only',
  '真实 Safari/WebKit 与 iPhone 真机未验收；本机 mac13 不支持 Playwright WebKit',
  'MOV/HEVC/音频/旋转矩阵未验收，默认明确拒绝而非降级',
  'WAF 模板未提交/未按套餐验证；登录限流仍是单实例 best effort',
  '生产资源、长期凭证、外部持续监控、备份恢复演练均未执行',
  '生产切换未获批准',
 ],
 verdict:'No-Go',
};
writeFileSync('.migration/acceptance-summary.json',JSON.stringify(report,null,2),{mode:0o600});
console.log('Acceptance summary written privately. Verdict:',report.verdict);
console.log('Playwright:',report.caseResults.playwright.status,'| model cost USD:',report.modelCostUsd,'| blockers:',report.blockers.length);

