// Build-time Node utility, never imported by application routes.
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
export function prepareMediaRuntime(){
 if(process.env.NEXT_PUBLIC_MEDIA_WASM_ENABLED==='false'){
  rmSync('public/runtime',{recursive:true,force:true});return;
 }
 mkdirSync('public/runtime/ffmpeg',{recursive:true});
 // Stable same-origin module worker; don't depend on bundler-generated Worker URLs.
 for(const name of readdirSync('node_modules/@ffmpeg/ffmpeg/dist/esm'))if(name.endsWith('.js'))copyFileSync(`node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`,`public/runtime/ffmpeg/${name}`);
 writeFileSync('public/runtime/NOTICE.txt','Browser video conversion uses @ffmpeg/ffmpeg 0.12.x (MIT) and @ffmpeg/core 0.12.10. Core contains FFmpeg and libx264 GPL components. Source/build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10 and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core . Generated binaries are not part of the Worker server runtime.\n');
 copyFileSync('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js','public/runtime/ffmpeg-core.js');
 const compressed=gzipSync(readFileSync('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm'),{level:9});
 if(compressed.length>25*1024*1024)throw new Error('compressed_wasm_exceeds_asset_limit');
 writeFileSync('public/runtime/ffmpeg-core.wasm.gz',compressed);
}
