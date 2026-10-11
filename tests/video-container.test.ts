import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compatibleMp4,videoFilters} from '../src/lib/video-container';
import {browserVideo} from '../src/lib/media-client';
import {mediaFetch,videoMetadata} from '../src/lib/media-metadata';
function box(kind:string,...data:Buffer[]){const payload=Buffer.concat(data),header=Buffer.alloc(8);header.writeUInt32BE(payload.length+8);header.write(kind,4);return Buffer.concat([header,payload]);}
function sample(codec:string,profile=100){
 const visual=Buffer.alloc(78),avc=box('avcC',Buffer.from([1,profile,0,40]));
 const entry=box(codec,visual,avc),count=Buffer.from([0,0,0,0,0,0,0,1]);
 return new File([box('ftyp',Buffer.from('isom')),box('mdat',Buffer.alloc(1024)),box('moov',box('trak',box('mdia',box('minf',box('stbl',box('stsd',count,entry))))))],'sample.mp4',{type:'video/mp4'});
}
test('MP4 H264 8-bit passes through; HEVC/High10/invalid files cannot bypass conversion',async()=>{
 const file=sample('avc1');assert.equal(await compatibleMp4(file),true);assert.equal(await browserVideo(file),file);
 for(const file of [sample('hvc1'),sample('hev1'),sample('avc1',110),new File(['bad'],'bad.mp4',{type:'video/mp4'})])assert.equal(await compatibleMp4(file),false);
});
test('SDR and HDR conversion end in 8-bit yuv420p; HDR is tone-mapped to BT709',()=>{
 assert.match(videoFilters(false),/format=yuv420p$/);assert.doesNotMatch(videoFilters(false),/tonemap/);
 assert.match(videoFilters(true),/tonemap=tonemap=mobius/);assert.match(videoFilters(true),/zscale=t=bt709/);
});
test('pre-cancelled video conversion and metadata extraction do not start work',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(browserVideo(new File(['bad'],'camera.mov'),{signal:controller.signal}),/取消/);
 await assert.rejects(videoMetadata(new Blob(['bad']),100,controller.signal),/取消/);
});
test('mediaFetch respects caller cancellation, independently of the network deadline',async()=>{
 const original=globalThis.fetch,controller=new AbortController();
 globalThis.fetch=async(_input,init)=>new Promise((_resolve,reject)=>{if(init?.signal?.aborted)reject(new Error('aborted'));else init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')));});
 try{const result=mediaFetch('https://synthetic.invalid',{signal:controller.signal},1000);controller.abort();await assert.rejects(result,/上传已取消/);}finally{globalThis.fetch=original;}
});
