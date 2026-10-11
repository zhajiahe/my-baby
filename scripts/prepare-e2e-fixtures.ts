import {readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';import{createHash}from'node:crypto';
const fixtures=JSON.parse(readFileSync('tests/e2e/fixtures.json','utf8')) as {name:string;url:string;sha256:string;bytes:number}[];
mkdirSync('.migration/fixtures',{recursive:true,mode:0o700});
for(const fixture of fixtures){const path='.migration/fixtures/'+fixture.name;let bytes:Buffer;
 if(existsSync(path))bytes=readFileSync(path);else{const response=await fetch(fixture.url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('fixture_download_failed');bytes=Buffer.from(await response.arrayBuffer());}
 if(bytes.length!==fixture.bytes||createHash('sha256').update(bytes).digest('hex')!==fixture.sha256)throw new Error('fixture_hash_changed_review_required');
 writeFileSync(path,bytes,{mode:0o600});console.log('Verified public fixture:',fixture.name);
}
