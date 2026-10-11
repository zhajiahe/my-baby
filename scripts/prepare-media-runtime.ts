// Build-time Node utility, never imported by application routes.
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
export function prepareMediaRuntime(){
 if(process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED!=='true'){
  rmSync('public/runtime',{recursive:true,force:true});return;
 }
 mkdirSync('public/runtime',{recursive:true});
 copyFileSync('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js','public/runtime/ffmpeg-core.js');
 const compressed=gzipSync(readFileSync('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm'),{level:9});
 if(compressed.length>25*1024*1024)throw new Error('compressed_wasm_exceeds_asset_limit');
 writeFileSync('public/runtime/ffmpeg-core.wasm.gz',compressed);
}
