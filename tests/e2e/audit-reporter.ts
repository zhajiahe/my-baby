import type {Reporter,TestCase,TestResult,FullResult} from '@playwright/test/reporter';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
export default class AuditReporter implements Reporter {
 rows:unknown[]=[];
 onTestEnd(test:TestCase,result:TestResult){
  this.rows.push({case:test.title,project:test.parent.project()?.name,status:result.status,durationMs:result.duration,
   errorHash:result.error?createHash('sha256').update(result.error.message||'').digest('hex'):null,
   privateEvidence:result.attachments.map(a=>({name:a.name,path:a.path}))});
  console.log(`${result.status}: ${test.parent.project()?.name}: ${test.title}`);
 }
 onEnd(result:FullResult){
  const finishedAt=new Date().toISOString(),record={finishedAt,status:result.status,
   deploymentCode:existsSync('.migration/code-version.json')?JSON.parse(readFileSync('.migration/code-version.json','utf8')):null,cases:this.rows};
  const data=JSON.stringify(record,null,2);writeFileSync(`.migration/e2e/results-${finishedAt.replace(/[:.]/g,'-')}.json`,data,{mode:0o600});
  writeFileSync('.migration/e2e/results.json',data,{mode:0o600});
 }
}
