import {readFileSync} from 'node:fs';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),secrets=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
const snapshot=JSON.parse(readFileSync('.migration/source.json','utf8'));
if(target.workerName!=='mybaby-web-migration-test'||!target.origin||new URL(target.origin).hostname.split('.')[0]!==target.workerName)throw new Error('test_target_required');
function check(ok:unknown,code:string):asserts ok{if(!ok)throw new Error(code);}
async function main(){
 const origin=target.origin;
 const unauth=await fetch(origin+'/api/baby');check(unauth.status===401,'anonymous_api_guard');
 const page=await fetch(origin,{redirect:'manual'});check(page.status===307||page.status===302,'anonymous_page_guard');
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({password:secrets.MYBABY_APP_PASSWORD})});
 check(login.status===200,'family_login');const cookie=login.headers.get('set-cookie')?.split(';')[0];check(cookie,'family_cookie');
 const call=(path:string,method='GET',body?:unknown)=>fetch(origin+path,{method,headers:{cookie,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const babyResponse=await call('/api/baby');check(babyResponse.status===200&&babyResponse.headers.get('cache-control')?.includes('no-store'),'baby_read_private');
 const baby=await babyResponse.json() as any;check(baby.id===snapshot.rows.babies[0].id,'source_id_preserved');
 const list=await call('/api/photos?babyId='+baby.id+'&limit=50');const listBody=await list.json() as any;
 check(listBody.pagination.total===snapshot.rows.media_items.length&&listBody.items.length===50,'album_pagination');
 const forbidden=await fetch(origin+'/api/growth-records',{method:'POST',headers:{cookie,'content-type':'application/json',origin:'https://invalid.example'},body:'{}'});
 check(forbidden.status===403,'csrf_guard');
 for(const type of ['growth-records','milestones']){
  const body=type==='growth-records'?{babyId:baby.id,date:'2026-10-10',weight:10.5}:{babyId:baby.id,date:'2026-10-10',title:'Synthetic CF smoke',tags:['synthetic']};
  const created=await call('/api/'+type,'POST',body);check(created.status===200||created.status===201,'crud_create_'+type);
  const row=await created.json() as any;check(row.id&&row.date==='2026-10-10T00:00:00.000Z','crud_utc_'+type);
  const path='/api/'+type+'/'+row.id;check((await call(path)).status===200,'crud_get_'+type);
  const updated=await call(path,'PUT',type==='growth-records'?{weight:11}:{title:'Synthetic updated',tags:[]});check(updated.status===200,'crud_update_'+type);
  if(type==='milestones')check((await updated.json() as any).tags.length===0,'json_tags');
  check((await call(path,'DELETE')).status===200,'crud_delete_'+type);
 }
 const signed=await call('/api/photos/generate-upload-url','POST',{contentType:'image/png',size:68});check(signed.status===200,'presign');
 const urls=await signed.json() as any;
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cFt8AAAAASUVORK5CYII=','base64');
 check(image.length===68,'fixture_length');
 const upload=await fetch(urls.uploadUrl,{method:'PUT',headers:{'content-type':'image/png'},body:image});check(upload.ok,'direct_r2_upload');
 const media=await call(urls.publicUrl);check(media.status===200&&media.headers.get('cache-control')?.includes('no-store'),'private_r2_read_http_'+media.status);
 check(Buffer.from(await media.arrayBuffer()).equals(image),'r2_byte_integrity');
 check((await fetch(origin+urls.publicUrl)).status===401,'media_login_guard');
 const form=new FormData();form.append('file',new File([image],'synthetic.png',{type:'image/png'}));
 const compatibility=await fetch(origin+'/api/photos/upload',{method:'POST',headers:{cookie,origin},body:form});
 check(compatibility.status===201,'avatar_stream_upload');const compatibilityResult=await compatibility.json() as any;
 check((await call(compatibilityResult.url)).ok,'avatar_private_read');
 const range=await fetch(origin+urls.publicUrl,{headers:{cookie,range:'bytes=0-7'}});check(range.status===206&&(await range.arrayBuffer()).byteLength===8,'r2_range');
 const saved=await call('/api/photos/batch','POST',{items:[{babyId:baby.id,date:'2026-10-10',url:urls.publicUrl,title:'Synthetic CF smoke',mediaType:'IMAGE',format:'png'}]});
 check(saved.ok,'album_batch');const result=await saved.json() as any;const item=result.items?.[0]||result[0];check(item?.id,'album_batch_shape');
 check((await call('/api/photos/'+item.id,'PUT',{title:'Synthetic edited'})).ok,'album_edit');
 check((await call('/api/photos/'+item.id,'DELETE')).ok,'album_delete');
 const req={source:'weixin',botId:'smoke',userId:'smoke',messageId:'smoke',operationKey:'op_0',operation:'get_baby_summary',args:{}};
 const agent=await fetch(origin+'/api/agent/v1',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(req)});check(agent.status===401,'cookie_not_agent_auth');
 const noGrant=await fetch(origin+'/api/agent/v1',{method:'POST',headers:{authorization:`Bearer ${secrets.MYBABY_AGENT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(req)});check(noGrant.status===403,'agent_fail_closed_http_'+noGrant.status);
 check((await call('/api/auth/logout','POST',{})).ok,'logout');
 console.log('PASS: cloud login/CSRF/privacy, source IDs, pagination, growth/milestone CRUD, JSON tags, R2 direct upload/bytes/range, album batch/edit/delete, Agent guards and logout.');
}
main().catch(error=>{console.error('Isolated HTTP smoke failed:',error instanceof Error?error.message:'unknown');process.exitCode=1;});
