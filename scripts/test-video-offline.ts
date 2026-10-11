// Real Chromium + actual WASM, localhost only. No CF/D1/R2/auth/grant operations.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {chromium,devices,type Page} from '@playwright/test';
import {prepareMediaRuntime} from './prepare-media-runtime';
prepareMediaRuntime();
const directory='.migration/iphone';mkdirSync(directory,{recursive:true,mode:0o700});
const modules:Record<string,string>={'/client/media-client':'src/lib/media-client.ts','/client/video-container':'src/lib/video-container.ts'};
const server=createServer((request,response)=>{
 response.setHeader('Cross-Origin-Opener-Policy','same-origin');response.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 const path=new URL(request.url||'/', 'http://localhost').pathname;
 if(path==='/'){
  response.setHeader('Content-Type','text/html');response.end('<script type="importmap">{"imports":{"@ffmpeg/ffmpeg":"/runtime/ffmpeg/index.js"}}</script><input type="file" id="video">');return;
 }
 if(modules[path]){
  response.setHeader('Content-Type','text/javascript');response.end(ts.transpileModule(readFileSync(modules[path],'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);return;
 }
 const file=resolve('public','.'+path),root=resolve('public/runtime')+'/';
 if(!path.startsWith('/runtime/')||!file.startsWith(root)||!existsSync(file)){response.writeHead(404);response.end();return;}
 response.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'application/octet-stream');response.end(readFileSync(file));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();if(!address||typeof address==='string')throw new Error('localhost_listener_required');
const origin=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({channel:process.env.MYBABY_E2E_CHROMIUM_BUNDLED==='true'?undefined:'chrome'});
const device=devices['iPhone 13'];
const context=await browser.newContext(process.argv.includes('--iphone-layout')?{viewport:device.viewport,userAgent:device.userAgent,deviceScaleFactor:device.deviceScaleFactor,isMobile:true,hasTouch:true}:{});
const page=await context.newPage();
const report:{kind:string;cases:Record<string,unknown>[];status:string;finishedAt?:string}={kind:'real-chromium-wasm-localhost-no-cloud-operations',cases:[],status:'passed'};
async function setup(page:Page){await page.goto(origin);await page.evaluate(()=>{(globalThis as unknown as {process:{env:Record<string,string>}}).process={env:{NEXT_PUBLIC_MEDIA_WASM_ENABLED:'true'}};});}
async function convert(page:Page,path:string){
 await page.locator('#video').setInputFiles(path);
 return page.evaluate(async()=>{
  // @ts-expect-error localhost transpiled module, resolved by the test HTTP server
  const {browserVideo}=await import('/client/media-client');
  const input=(document.querySelector('#video') as HTMLInputElement).files![0],start=performance.now();
  const blob:Blob=await browserVideo(input),video=document.createElement('video'),url=URL.createObjectURL(blob);
  video.muted=true;video.playsInline=true;document.body.appendChild(video);video.src=url;
  try{
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('output_decode_timeout')),15000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('output_decode_error'));};});
   await video.play();await new Promise(r=>setTimeout(r,300));if(video.currentTime<=0)throw new Error('output_not_playing');
   const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return{width:video.videoWidth,height:video.videoHeight,duration:video.duration,elapsedMs:Math.round(performance.now()-start),base64:btoa(binary)};
  }finally{video.removeAttribute('src');video.load();video.remove();URL.revokeObjectURL(url);}
 });
}
try{
 await setup(page);
 const originals=process.argv.includes('--originals');
 const paths=originals?[0,1,2,3,4].map(i=>`${directory}/original-${i}.${i===1?'mp4':'mov'}`):['synthetic-h264.mov','synthetic-rotated.mov','synthetic-hevc-hlg.mov','synthetic-hevc.mp4'].map(name=>'.migration/fixtures/'+name);
 for(const path of paths){
  const sample=path.split('/').pop()!;
  try{
   const result=await convert(page,path),bytes=Buffer.from(result.base64,'base64'),output=join(directory,'offline-'+sample+'.mp4');writeFileSync(output,bytes,{mode:0o600});
   if(sample.includes('rotated')&&(result.width!==180||result.height!==320))throw new Error('rotation_not_preserved');
   const encoder=process.env.MYBABY_FIXTURE_FFMPEG||'ffmpeg';execFileSync(encoder,['-hide_banner','-i',output,'-f','null','-'],{timeout:60000,stdio:['ignore','pipe','pipe']});
   let streams='';try{execFileSync(encoder,['-hide_banner','-i',output],{stdio:['ignore','pipe','pipe']});}catch(error){streams=String((error as {stderr?:Buffer}).stderr||'');}
   if(!/Video: h264 .*yuv420p\(/.test(streams)||/Video:.*(?:High 10|yuv420p10)/.test(streams)||!/Audio: aac/.test(streams))throw new Error('output_codec_or_audio_incompatible');
   if(sample.includes('hlg')&&!/Video:.*bt709/.test(streams))throw new Error('hdr_not_tonemapped');
   report.cases.push({sample,sourceKind:originals?'isolated-archive-copy':'synthetic',status:'passed',width:result.width,height:result.height,duration:result.duration,elapsedMs:result.elapsedMs,video:'h264-8bit',audio:'aac',nativeDecoded:true,sha256:createHash('sha256').update(bytes).digest('hex')});
   console.log('PASS:',sample,'8-bit H264/AAC decode and playback',`${result.width}x${result.height}`);
  }catch(error){report.status='failed';const failure=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'private_conversion_failure';report.cases.push({sample,status:'failed',failure});console.log('FAIL:',sample,failure);}
 }
 if(!originals){
  const cancelPage=await context.newPage();await setup(cancelPage);await cancelPage.locator('#video').setInputFiles('.migration/fixtures/synthetic-hevc-hlg.mov');
  let entered!:()=>void;const loading=new Promise<void>(resolve=>{entered=resolve;});
  await cancelPage.route('**/runtime/ffmpeg-core.wasm.gz',async route=>{entered();await new Promise(r=>setTimeout(r,1000));await route.continue().catch(()=>{});});
  const pending=cancelPage.evaluate(async()=>{
   // @ts-expect-error localhost transpiled module
   const {browserVideo}=await import('/client/media-client'),controller=new AbortController();
   (globalThis as unknown as {cancelVideo:()=>void}).cancelVideo=()=>controller.abort();
   try{await browserVideo((document.querySelector('#video') as HTMLInputElement).files![0],{signal:controller.signal});return false;}catch(error){return error instanceof Error&&error.message.includes('取消');}
  });
  await loading;await cancelPage.evaluate(()=>(globalThis as unknown as {cancelVideo:()=>void}).cancelVideo());
  if(!await pending)throw new Error('cancel_not_observed');await cancelPage.unroute('**/runtime/ffmpeg-core.wasm.gz');await convert(cancelPage,'.migration/fixtures/synthetic-hevc-hlg.mov');
  report.cases.push({sample:'cancel_then_retry',status:'passed'});console.log('PASS: cancelled core loading; retry uses a fresh engine and plays.');await cancelPage.close();
 }
}catch(error){report.status='failed';report.cases.push({sample:'suite',status:'failed',failure:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'private_test_failure'});}
finally{
 report.finishedAt=new Date().toISOString();const data=JSON.stringify(report,null,2);writeFileSync(`${directory}/offline-${Date.now()}.json`,data,{mode:0o600});writeFileSync(`${directory}/offline-latest.json`,data,{mode:0o600});
 await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));if(report.status!=='passed')process.exitCode=1;
}
