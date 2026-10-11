import {expect,test,type APIRequestContext,type APIResponse,type Page} from '@playwright/test';
// These retries are transport-only (ECONNRESET), never retries of HTTP assertion
// failures. Reads and login are safe; business writes still use real browser UI.
export const transportOptions={maxRetries:3,timeout:60000};
export const testProxy=process.env.MYBABY_E2E_PROXY?{proxy:{server:process.env.MYBABY_E2E_PROXY}}:{};
export async function readApi(api:APIRequestContext|Page,url:string,options:Parameters<APIRequestContext['get']>[1]={}):Promise<Pick<APIResponse,'status'|'headers'|'body'|'json'|'ok'>>{
 if(!('evaluate' in api))return api.get(url,{...transportOptions,...options});
 // Read through the real browser's networking stack, not Node's TLS client.
 // This also tests authenticated fetch/CORS behavior actually used by the UI.
 const result=await api.evaluate(async({url,headers,timeout})=>{
  const address=new URL(url,location.origin);if(address.origin!==location.origin)throw new Error('same_origin_read_required');
  const response=await fetch(address,{headers,signal:AbortSignal.timeout(timeout)}),bytes=new Uint8Array(await response.arrayBuffer());
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return{status:response.status,headers:Object.fromEntries(response.headers),base64:btoa(binary)};
 },{url,headers:options.headers,timeout:options.timeout||transportOptions.timeout});
 const body=Buffer.from(result.base64,'base64');
 return{status:()=>result.status,headers:()=>result.headers,body:async()=>body,json:async()=>JSON.parse(body.toString('utf8')),ok:()=>result.status>=200&&result.status<300};
}
export async function navigate(page:Page,url='/'){
 for(let attempt=0;attempt<3;attempt++){
  try{return await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});}
  catch(error){
   const code=error instanceof Error?/net::(ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_TIMED_OUT)/.exec(error.message)?.[1]:undefined;
   if(!code||attempt===2)throw error;
   test.info().annotations.push({type:'transport_retry',description:`navigation attempt=${attempt+1} code=${code}`});
   await page.waitForTimeout(2000);
  }
 }
 throw new Error('navigation_transport_unavailable');
}
export async function ensureFamilySession(page:Page,password:string){
 await navigate(page);
 if(new URL(page.url()).pathname==='/login'){
  await page.getByRole('textbox',{name:'访问密码'}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 }
 await expect(page.getByTestId('app-shell')).toHaveAttribute('data-hydrated','true');
}

