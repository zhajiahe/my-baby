// Native FFmpeg is only a test-fixture encoder, never part of Web/Worker runtime.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir='.migration/fixtures';mkdirSync(dir,{recursive:true,mode:0o700});
const encoder=process.env.MYBABY_FIXTURE_FFMPEG||'ffmpeg';
function run(args:string[]){try{execFileSync(encoder,['-hide_banner','-loglevel','error','-y',...args],{timeout:60000,stdio:['ignore','pipe','pipe']});}catch{throw new Error('native_test_fixture_encoder_failed');}}
const video=['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=880:sample_rate=44100','-t','2'];
run([...video,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',`${dir}/synthetic-h264.mov`]);
run(['-display_rotation','90','-i',`${dir}/synthetic-h264.mov`,'-c','copy',`${dir}/synthetic-rotated.mov`]);
run([...video,'-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p10le','-x265-params','log-level=error:pools=1:colorprim=9:transfer=18:colormatrix=9','-tag:v','hvc1','-color_primaries','bt2020','-color_trc','arib-std-b67','-colorspace','bt2020nc','-c:a','aac',`${dir}/synthetic-hevc-hlg.mov`]);
run([...video,'-c:v','libx265','-preset','ultrafast','-pix_fmt','yuv420p','-x265-params','log-level=error:pools=1','-tag:v','hvc1','-c:a','aac',`${dir}/synthetic-hevc.mp4`]);
run(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2','-c:v','libvpx','-b:v','256k','-an','.migration/synthetic.webm']);
const names=['synthetic-h264.mov','synthetic-rotated.mov','synthetic-hevc-hlg.mov','synthetic-hevc.mp4'];
const report=names.map(name=>{const bytes=readFileSync(`${dir}/${name}`);return{name,kind:'synthetic-not-an-iPhone-original',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
writeFileSync(`${dir}/video-fixtures.json`,JSON.stringify(report),{mode:0o600});
console.log('Generated synthetic H264 MOV, rotated MOV, HEVC Main10 HLG MOV and HEVC MP4 fixtures.');
