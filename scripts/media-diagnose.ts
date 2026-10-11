import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),secrets=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
if(new URL(target.origin).hostname.split('.')[0]!=='mybaby-web-migration-test')throw new Error('isolated_origin_required');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();page.setDefaultTimeout(10000);const evidence:unknown[]=[];let phase='login';
page.on('pageerror',error=>evidence.push({event:'pageerror',category:error.name}));
page.on('crash',()=>evidence.push({event:'crash'}));
page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/')||url.hostname.endsWith('.r2.cloudflarestorage.com'))
 evidence.push({event:'response',phase:url.hostname.endsWith('.r2.cloudflarestorage.com')?'r2':url.pathname.replace(/\/api\/media\/.*/, '/api/media/[private]'),status:response.status()});});
try{
 await page.goto(target.origin+'/login');await page.getByRole('textbox',{name:'访问密码'}).fill(secrets.MYBABY_APP_PASSWORD);
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(target.origin+'/');
 await page.waitForTimeout(3000);
 phase='gallery';await page.getByRole('button',{name:'照片墙',exact:true}).click();
 await page.waitForTimeout(2000);
 phase='open_form';await page.getByRole('button',{name:'上传媒体文件',exact:true}).click();
 phase='select';await page.locator('input[type=file]').setInputFiles('.migration/synthetic.webm');
 phase='submit';await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();
 await page.waitForTimeout(15000);
 evidence.push({event:'state',uploadClosed:await page.getByRole('button',{name:'取消',exact:true}).count()===0,
  errors:await page.getByText('上传失败',{exact:true}).count()});
 console.log('Playwright media diagnostic complete (private evidence saved).');
} catch(error){evidence.push({event:'failed',phase,category:error instanceof Error?error.name:'unknown'});writeFileSync('.migration/media-diagnosis-error.txt',String(error),{mode:0o600});console.log('Diagnostic failed; private evidence saved.');}
finally{writeFileSync('.migration/media-diagnosis.json',JSON.stringify(evidence,null,2),{mode:0o600});await browser.close();}
