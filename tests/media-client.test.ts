import {test}from'node:test';import assert from'node:assert/strict';
import{normalizeMediaFile,browserVideo}from'../src/lib/media-client';import{videoMetadata,mediaFetch}from'../src/lib/media-metadata';
test('Safari empty MIME is normalized and unsupported MOV never reports conversion success',async()=>{
 const mp4=normalizeMediaFile(new File(['synthetic'],'camera.mp4',{type:''}));assert.equal(mp4.type,'video/mp4');assert.equal(await browserVideo(mp4),mp4);
 assert.equal(normalizeMediaFile(new File(['synthetic'],'camera.HEIC')).type,'image/heic');
 const prior=process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED;delete process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED;
 try{await assert.rejects(browserVideo(normalizeMediaFile(new File(['synthetic'],'camera.MOV'))),/MP4/);}finally{if(prior!==undefined)process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED=prior;}
});
test('thumbnail encoder stall times out and releases attached video/object URL',async()=>{
 const prior=globalThis.document;let removed=false;let revoked=false;const revoke=URL.revokeObjectURL;
 const video:any={style:{},duration:Infinity,videoWidth:640,videoHeight:480,readyState:2,removeAttribute(){this.src='';},remove(){removed=true;},load(){if(this.src){queueMicrotask(()=>this.onloadeddata?.());}}};
 globalThis.document={body:{appendChild(){}},createElement(name:string){return name==='video'?video:{getContext(){return{drawImage(){}};},toBlob(){/* intentionally never acknowledges encoding */}};}} as unknown as Document;
 URL.revokeObjectURL=()=>{revoked=true;};
 try{await assert.rejects(videoMetadata(new Blob(['synthetic']),20),/超时/);assert.ok(removed&&revoked);assert.equal(video.onloadeddata,null);}
 finally{globalThis.document=prior;URL.revokeObjectURL=revoke;}
});
test('media network deadline aborts requests and returns a safe actionable error',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=async(_input,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('private transport details'))));
 try{await assert.rejects(mediaFetch('https://synthetic.invalid',{},10),/^Error: 网络请求超时/);}finally{globalThis.fetch=prior;}
});
