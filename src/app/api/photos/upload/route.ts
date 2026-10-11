import { NextResponse } from 'next/server';
import { bindings } from '@/lib/db';
// Compatibility upload for avatars/older callers. Stream to isolated R2;
// HEIC/video conversion belongs in the browser, never Sharp/FFmpeg/FS here.
const extensions:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
export async function POST(request:Request) {
 try {
  const length=Number(request.headers.get('content-length'));
  if(!length||length>100*1024*1024)return NextResponse.json({error:'use_direct_upload'},{status:413});
  const form=await request.formData(),file=form.get('file');
  if(!(file instanceof File)||!file.size)return NextResponse.json({error:'file_required'},{status:400});
  const format=extensions[file.type];if(!format)return NextResponse.json({error:'browser_conversion_required'},{status:415});
  const key=`uploads/${crypto.randomUUID()}.${format}`;
  const {MEDIA}=await bindings();await MEDIA.put(key,file.stream() as unknown as Parameters<typeof MEDIA.put>[1],{httpMetadata:{contentType:file.type}});
  return NextResponse.json({url:`/api/media/${key}`,format,mediaType:file.type.startsWith('video/')?'VIDEO':'IMAGE',thumbnailUrl:null,duration:null},{status:201});
 }catch{return NextResponse.json({error:'upload_failed'},{status:500});}
}
