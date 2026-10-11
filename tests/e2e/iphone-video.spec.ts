import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readApi,testProxy,ensureFamilySession,navigate} from './api';
import {createHash} from 'node:crypto';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),secret=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
let cookies:Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>=[];
test.beforeAll(async({browser},info)=>{
 const path=`.migration/e2e/auth-${info.project.name}.json`,page=await browser.newPage({baseURL:target.origin,...testProxy});
 try{
  if(existsSync(path))await page.context().addCookies(JSON.parse(readFileSync(path,'utf8')));
  await ensureFamilySession(page,secret.MYBABY_APP_PASSWORD);cookies=await page.context().cookies();writeFileSync(path,JSON.stringify(cookies),{mode:0o600});
 }finally{await page.close();}
});
test.beforeEach(async({page,context})=>{
 await context.addCookies(cookies);await navigate(page);
 await expect(page.getByTestId('app-shell')).toHaveAttribute('data-hydrated','true');
 await page.getByRole('button',{name:'照片墙',exact:true}).click();await page.getByRole('button',{name:'上传媒体文件',exact:true}).click();
});
// The upload no longer re-encodes anything before storing it, so the contract under test is
// that the ORIGINAL container reaches R2 byte for byte. Playback is asserted only where the
// browser really has the codec; elsewhere the UI must say so instead of showing a dead player.
async function upload(page:Page,path:string){
 await page.locator('input[type=file]').setInputFiles(path);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST',{timeout:180000});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);
 const row=await response.json();
 await page.getByTestId(`media-card-${row.id}`).click();
 return {row};
}
function mimeFor(format:string,codec:'h264'|'hevc'){
 const container=format==='mov'?'video/quicktime':'video/mp4';
 return codec==='hevc'?`${container}; codecs="hvc1"`:container;
}
interface Sample {name:string;format:'mov'|'mp4';codec:'h264'|'hevc';kind:string;size:{width:number;height:number}}
const samples:Sample[]=[
 {name:'synthetic-h264.mov',format:'mov',codec:'h264' as const,kind:'synthetic-not-iPhone-original',size:{width:320,height:180}},
 {name:'synthetic-rotated.mov',format:'mov',codec:'h264' as const,kind:'synthetic-not-iPhone-original',size:{width:180,height:320}},
 {name:'synthetic-hevc-hlg.mov',format:'mov',codec:'hevc' as const,kind:'synthetic-not-iPhone-original',size:{width:320,height:180}},
 {name:'synthetic-hevc.mp4',format:'mp4',codec:'hevc' as const,kind:'synthetic-not-iPhone-original',size:{width:320,height:180}},
];
if(process.env.MYBABY_E2E_ARCHIVE_SAMPLES==='true')for(let i=0;i<5;i++){
 const name=`original-${i}.${i===1?'mp4':'mov'}`;
 samples.push({name,format:i===1?'mp4':'mov',codec:'hevc',kind:'isolated-archive-copy',size:[{width:1280,height:942},{width:720,height:1280},{width:960,height:1280},{width:960,height:1280},{width:720,height:1280}][i]});
}
for(const input of samples){
 const sample=input.name,path='.migration/fixtures/'+sample;
 test(`${sample}: original is archived untouched with no pre-upload transcoding`,async({page},info)=>{
  test.setTimeout(210000);
  // Regression guard for the iPhone bottleneck: the WASM converter must never load on the
  // upload path, because a phone paid ~10 MB of core download plus a full re-encode before
  // the original was stored and reported no progress while doing it.
  const runtime:string[]=[];
  page.on('request',request=>{if(request.url().includes('/runtime/ffmpeg'))runtime.push(request.url());});
  const {row}=await upload(page,path);
  expect(runtime).toEqual([]);
  expect(row.format).toBe(input.format);
  expect(row.mediaType).toBe('VIDEO');
  // Stored bytes must equal the selected bytes, not a re-encoded derivative.
  const original=readFileSync(path);
  const stored=await readApi(page,row.url);expect(stored.status()).toBe(200);
  const bytes=Buffer.from(await stored.body());
  expect(bytes.length).toBe(original.length);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
  // Streaming needs Range: the archived original is served as 206 with a real total.
  const first=await readApi(page,row.url,{headers:{range:'bytes=0-0'}});
  expect(first.status()).toBe(206);expect((await first.body()).length).toBe(1);
  const total=/^bytes 0-0\/(\d+)$/.exec(first.headers()['content-range']||'');expect(total).toBeTruthy();
  expect(Number(total![1])).toBe(original.length);
  // The container itself must still be a decodable video, not merely a matching size.
  const copy=`.migration/e2e/${info.project.name}-${sample}`;writeFileSync(copy,bytes,{mode:0o600});
  const ffmpeg=process.env.MYBABY_FIXTURE_FFMPEG||'ffmpeg';let stderr='';
  try{execFileSync(ffmpeg,['-hide_banner','-xerror','-i',copy,'-f','null','-'],{timeout:30000,stdio:['ignore','pipe','pipe']});}
  catch(error){stderr=String((error as {stderr?:Buffer}).stderr||'');throw new Error('archived_original_not_decodable_'+createHash('sha256').update(stderr).digest('hex').slice(0,12));}
  // A cover is best effort and must never block the upload; assert it when the device or
  // browser captured one, but never fail the archive because a codec was unavailable.
  // Same reason duration is only required where the engine can actually decode the codec.
  const playable=await page.evaluate(type=>!!document.createElement('video').canPlayType(type),mimeFor(input.format,input.codec));
  if(playable){
   expect(row.duration).toBeGreaterThan(0);
   expect(row.thumbnailUrl).toBeTruthy();
  }
  if(row.thumbnailUrl){const cover=await readApi(page,row.thumbnailUrl);expect(cover.status()).toBe(200);expect((await cover.body()).length).toBeGreaterThan(0);}
  // Playback follows the real capability of the project, not the expectation of a transcode.
  if(playable){
   const player=page.locator('video').last();await expect(player).toBeVisible();
   await player.evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});
   await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0.1);
  }else{
   await expect(page.getByText(/此浏览器不支持播放该视频格式/)).toBeVisible();
   await expect(page.getByRole('link',{name:'下载原片'})).toBeVisible();
  }
  writeFileSync(copy+'.json',JSON.stringify({fixture:sample,sourceKind:input.kind,project:info.project.name,
   archived:'original',container:input.format,codec:input.codec,playableOnThisEngine:playable,...input.size,
   sha256:createHash('sha256').update(bytes).digest('hex')}),{mode:0o600});
 });
}
test('cancel during the upload leaves no record and a later attempt succeeds',async({page})=>{
 test.setTimeout(210000);let saves=0;page.on('request',request=>{if(request.url().endsWith('/api/photos')&&request.method()==='POST')saves++;});
 // Stall the part-signing call so the cancel lands while the original is still transferring.
 let entered!:()=>void;const signing=new Promise<void>(resolve=>{entered=resolve;});
 await page.route('**/api/photos/multipart',async route=>{if(route.request().postData()?.includes('"sign"')){entered();await new Promise(resolve=>setTimeout(resolve,1500));}await route.continue().catch(()=>{});});
 await page.locator('input[type=file]').setInputFiles('.migration/fixtures/synthetic-hevc-hlg.mov');
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();await signing;
 await page.getByRole('button',{name:'取消上传',exact:true}).click();await expect(page.locator('p').filter({hasText:/✗.*取消/})).toBeVisible();expect(saves).toBe(0);
 await page.unroute('**/api/photos/multipart');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST',{timeout:180000});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();expect((await saved).status()).toBe(201);expect(saves).toBe(1);
});
