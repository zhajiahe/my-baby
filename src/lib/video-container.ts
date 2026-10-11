// Inspect only bounded ISO-BMFF metadata, skipping mdat. No media bytes are logged.
export async function compatibleMp4(file:File):Promise<boolean>{
 if(file.type!=='video/mp4'||! /\.mp4$/i.test(file.name))return false;
 const type=(bytes:Uint8Array,offset:number)=>String.fromCharCode(...bytes.slice(offset,offset+4));
 let offset=0;
 for(let boxes=0;offset+8<=file.size&&boxes<1000;boxes++){
  const header=new Uint8Array(await file.slice(offset,offset+16).arrayBuffer());
  const view=new DataView(header.buffer);let size=view.getUint32(0),length=8;
  if(size===1){if(header.length<16)return false;const extended=view.getBigUint64(8);if(extended>BigInt(Number.MAX_SAFE_INTEGER))return false;size=Number(extended);length=16;}
  if(size===0)size=file.size-offset;
  if(size<length||offset+size>file.size)return false;
  if(type(header,4)==='moov'){
   if(size>4*1024*1024)return false;
   const bytes=new Uint8Array(await file.slice(offset+length,offset+size).arrayBuffer());
   let video=false,safe=true;
   const walk=(start:number,end:number,depth:number)=>{
    if(depth>8){safe=false;return;}
    for(let i=start;i+8<=end;){
     const size=new DataView(bytes.buffer).getUint32(i),kind=type(bytes,i+4);
     if(size<8||i+size>end){safe=false;return;}
     if(['trak','mdia','minf','stbl'].includes(kind))walk(i+8,i+size,depth+1);
     if(kind==='stsd'){
      if(size<16){safe=false;return;}
      const count=new DataView(bytes.buffer).getUint32(i+12);let entry=i+16;
      for(let n=0;n<count;n++){
       if(entry+8>i+size){safe=false;return;}
       const entrySize=new DataView(bytes.buffer).getUint32(entry),codec=type(bytes,entry+4);
       if(entrySize<8||entry+entrySize>i+size){safe=false;return;}
       if(['avc1','avc3'].includes(codec)){
        video=true;let avc=false;
        // VisualSampleEntry header is 78 bytes following the 8-byte box header.
        for(let p=entry+86;p+8<=entry+entrySize;){
         const childSize=new DataView(bytes.buffer).getUint32(p);
         if(childSize<8||p+childSize>entry+entrySize){safe=false;break;}
         if(type(bytes,p+4)==='avcC'){avc=childSize>=12&&[66,77,100].includes(bytes[p+9]);}
         p+=childSize;
        }
        if(!avc)safe=false;
       }else if(!['mp4a','mett','metx'].includes(codec))safe=false;
       entry+=entrySize;
      }
     }
     i+=size;
    }
   };
   walk(0,bytes.length,0);return video&&safe;
  }
  offset+=size;
 }
 return false;
}
export function videoFilters(hdr:boolean):string{
 const scale="scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
 return [scale,...(hdr?['zscale=t=linear:npl=100','format=gbrpf32le','zscale=p=bt709','tonemap=tonemap=mobius:desat=0','zscale=t=bt709:m=bt709:r=tv']:[]),'fps=30','format=yuv420p'].join(',');
}
