import {NextResponse} from 'next/server';
import {equalSecret} from '@/lib/auth';import{bindings}from'@/lib/db';
export const runtime='nodejs';
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store'};const token=process.env.MYBABY_OPERATIONS_TOKEN||'';
 if(token.length<32||!equalSecret(request.headers.get('authorization')||'',`Bearer ${token}`))return NextResponse.json({error:'unauthorized'},{status:401,headers});
 try{
  const {DB,MEDIA}=await bindings();const session=DB.withSession('first-primary');
  const guard=await session.prepare("SELECT value FROM deployment_guard WHERE name='environment'").first<{value:string}>();
  const deployment=process.env.MYBABY_DEPLOYMENT;
  if(guard?.value!==(deployment==='migration-test'?'mybaby-cloudflare-migration-test':'mybaby-production'))throw new Error('guard_mismatch');
  await MEDIA.head('__ops_readonly_probe__');
  return NextResponse.json({ok:true,codeVersion:process.env.MYBABY_CODE_VERSION||'unversioned',deployment,
   writesFrozen:process.env.MYBABY_WRITES_FROZEN==='true',rehearsalMarker:process.env.MYBABY_REHEARSAL_MARKER||undefined,agentWritesEnabled:process.env.MYBABY_AGENT_WRITES_ENABLED==='true'}, {headers});
 }catch{return NextResponse.json({ok:false,error:'dependency_unavailable'},{status:503,headers});}
}
