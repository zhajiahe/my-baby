import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),secret=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
let cookies:Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>=[];
test.beforeAll(async({browser})=>{
 const page=await browser.newPage();const result=await page.request.post(target.origin+'/api/auth/login',{headers:{origin:target.origin},data:{password:secret.MYBABY_APP_PASSWORD}});
 expect(result.status()).toBe(200);cookies=await page.context().cookies();await page.close();
});
test.beforeEach(async({page,context})=>{
 await context.addCookies(cookies);await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('app-shell')).toHaveAttribute('data-hydrated','true');
 await page.getByRole('button',{name:'照片墙',exact:true}).click();await page.getByRole('button',{name:'上传媒体文件',exact:true}).click();
});
async function upload(page:Page,path:string){
 await page.locator('input[type=file]').setInputFiles(path);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST',{timeout:180000});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);
 const row=await response.json();expect(row.format).toBe('mp4');expect(row.duration).toBeGreaterThan(0);expect(row.thumbnailUrl).toBeTruthy();
 await page.getByTestId(`media-card-${row.id}`).click();const player=page.locator('video').last();await expect(player).toBeVisible();
 await player.evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0.1);
 return {row,player};
}
for(const sample of ['synthetic-h264.mov','synthetic-rotated.mov','synthetic-hevc-hlg.mov','synthetic-hevc.mp4']){
 test(`${sample}: direct selection converts to playable 8-bit H264/AAC`,async({page},info)=>{
  test.setTimeout(210000);const {row,player}=await upload(page,`.migration/fixtures/${sample}`);
  const size=await player.evaluate((v:HTMLVideoElement)=>({width:v.videoWidth,height:v.videoHeight}));
  expect(size).toEqual(sample.includes('rotated')?{width:180,height:320}:{width:320,height:180});
  const response=await page.request.get(row.url);expect(response.status()).toBe(200);const bytes=await response.body();
  const path=`.migration/e2e/${info.project.name}-${sample}.mp4`;writeFileSync(path,bytes,{mode:0o600});
  const ffmpeg=process.env.MYBABY_FIXTURE_FFMPEG||'ffmpeg';let stderr='';
  // Decode the actual downloaded output, not merely its extension or MIME.
  try{execFileSync(ffmpeg,['-hide_banner','-i',path,'-f','null','-'],{timeout:30000,stdio:['ignore','pipe','pipe']});}
  catch(error){stderr=String((error as {stderr?:Buffer}).stderr||'');throw new Error('converted_output_native_decode_failed_'+createHash('sha256').update(stderr).digest('hex').slice(0,12));}
  // Capture only stream metadata from a separate probe; never log original EXIF/location.
  try{execFileSync(ffmpeg,['-hide_banner','-i',path],{stdio:['ignore','pipe','pipe']});}
  catch(error){stderr=String((error as {stderr?:Buffer}).stderr||'');}
  expect(stderr).toMatch(/Video: h264 .*yuv420p\(/);expect(stderr).not.toMatch(/Video:.*(?:High 10|yuv420p10)/);expect(stderr).toMatch(/Audio: aac/);
  if(sample.includes('hlg'))expect(stderr).toMatch(/Video:.*bt709/);
  writeFileSync(path+'.json',JSON.stringify({fixture:sample,sourceKind:'synthetic-not-iPhone-original',project:info.project.name,video:'h264-8bit',audio:'aac',...size,sha256:createHash('sha256').update(bytes).digest('hex')}),{mode:0o600});
 });
}
test('cancel during core loading does not save and the next conversion succeeds',async({page})=>{
 test.setTimeout(210000);let saves=0;page.on('request',r=>{if(r.url().endsWith('/api/photos')&&r.method()==='POST')saves++;});
 let entered:()=>void;const loading=new Promise<void>(resolve=>{entered=resolve;});
 await page.route('**/runtime/ffmpeg-core.wasm.gz',async route=>{entered();await new Promise(resolve=>setTimeout(resolve,1000));await route.continue().catch(()=>{});});
 await page.locator('input[type=file]').setInputFiles('.migration/fixtures/synthetic-hevc-hlg.mov');
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();await loading;
 await page.getByRole('button',{name:'取消上传',exact:true}).click();await expect(page.locator('p').filter({hasText:/✗.*取消/})).toBeVisible();expect(saves).toBe(0);
 await page.unroute('**/runtime/ffmpeg-core.wasm.gz');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST',{timeout:180000});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();expect((await saved).status()).toBe(201);expect(saves).toBe(1);
});
