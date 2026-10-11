export {};
// External scheduler entrypoint. Secret headers and health bodies never enter alerts/logs.
const origin=process.env.MYBABY_MONITOR_ORIGIN,token=process.env.MYBABY_MONITOR_TOKEN,webhook=process.env.MYBABY_ALERT_WEBHOOK;
if(!origin||!token||token.length<32||!webhook)throw new Error('monitor_configuration_required');
const url=new URL(origin),hook=new URL(webhook);
if(url.protocol!=='https:'||hook.protocol!=='https:'||!['mybaby-web-migration-test','mybaby-web-production'].includes(url.hostname.split('.')[0]))throw new Error('approved_https_monitor_target_required');
let healthy=false;
try{
 const response=await fetch(url.origin+'/api/ops/health',{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'});
 const data=await response.json() as {ok?:boolean};healthy=response.status===200&&data.ok===true;
}catch{/* fixed, privacy-safe dependency failure */}
if(process.argv.includes('--simulate-failure'))healthy=false;
const event={service:url.hostname.split('.')[0],observedAt:new Date().toISOString(),status:healthy?'healthy':'unhealthy',simulated:process.argv.includes('--simulate-failure')};
// Scheduler/receiver must deduplicate consecutive events and route recovery notifications.
const response=await fetch(hook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(15000),redirect:'error'});
if(!response.ok)throw new Error('alert_delivery_failed');
console.log('Privacy-safe monitor event delivered:',event.status);
if(!healthy)process.exitCode=1;
