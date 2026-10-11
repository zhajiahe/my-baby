import {test,expect,type Page} from '@playwright/test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const target=JSON.parse(readFileSync('.migration/target.json','utf8')),secret=JSON.parse(readFileSync('.migration/secrets.json','utf8'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cFt8AAAAASUVORK5CYII=','base64');
async function login(page:Page){await page.goto('/login',{waitUntil:'domcontentloaded'});await page.getByRole('textbox',{name:'访问密码'}).fill(secret.MYBABY_APP_PASSWORD);
 await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByTestId('app-shell')).toHaveAttribute('data-hydrated','true');}
async function gallery(page:Page){await page.getByRole('button',{name:'照片墙',exact:true}).click();await page.getByRole('button',{name:'上传媒体文件',exact:true}).click();}
let cookies:Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>>=[];
test.beforeAll(async({browser},info)=>{
 const path=`.migration/e2e/auth-${info.project.name}.json`;
 const page=await browser.newPage();
 if(existsSync(path)){cookies=JSON.parse(readFileSync(path,'utf8'));await page.context().addCookies(cookies);
  if((await page.request.get(target.origin+'/api/baby')).status()!==200)cookies=[];}
 if(!cookies.length){await login(page);cookies=await page.context().cookies();writeFileSync(path,JSON.stringify(cookies),{mode:0o600});}
 await page.close();
});
test.beforeEach(async({page,context})=>{await context.addCookies(cookies);await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('app-shell')).toHaveAttribute('data-hydrated','true');});
test('media APIs reject external references, incomplete objects and spoofed files',async({page})=>{
 const post=(path:string,data:unknown)=>page.request.post(path,{headers:{origin:target.origin},data});
 const input={babyId:'e2e-baby',date:'2025-01-01',url:'https://invalid.example/a.png',format:'png',mediaType:'IMAGE'};
 expect((await post('/api/photos',input)).status()).toBe(400);
 expect((await post('/api/photos/batch',{items:[input]})).status()).toBe(400);
 const uploadId=crypto.randomUUID(),url=`/api/media/uploads/${uploadId}.png`;
 expect((await post('/api/photos',{...input,url})).status()).toBe(409);
 const signed=await post('/api/photos/generate-upload-url',{uploadId,contentType:'image/png',size:32});
 expect(signed.status()).toBe(200);const upload=await signed.json();
 const fake=await page.request.put(upload.uploadUrl,{headers:{'content-type':'image/png'},data:Buffer.alloc(32,60)});expect(fake.ok()).toBe(true);
 expect((await post('/api/photos',{...input,url})).status()).toBe(415);
 expect((await post('/api/photos/batch',{items:[{...input,url}]})).status()).toBe(415);
 expect((await post('/api/photos/generate-upload-url',{contentType:'image/png'})).status()).toBe(400);
});
test('family login/logout and anonymous data/media/Agent rejection',async({page,request})=>{
 expect((await request.get('/api/baby')).status()).toBe(401);
 expect((await request.get('/api/media/uploads/not-a-real-file.png')).status()).toBe(401);
 expect((await page.request.post('/api/agent/v1',{headers:{origin:target.origin},data:{}})).status()).toBe(401);
 await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page).toHaveURL(/\/login$/);
 expect((await page.request.get('/api/baby')).status()).toBe(401);
});
test('all page navigation is usable after hydration',async({page})=>{
 for(const name of ['成长记录','随心记','照片墙','首页']){
  const button=page.getByRole('button',{name,exact:true});await button.click();await expect(button).toHaveAttribute('aria-current','page');
 }
});
test('profile create UI with empty-state fixture persists real D1 row',async({page})=>{
 await page.route('**/api/baby',async route=>{if(route.request().method()==='GET')await route.fulfill({status:200,contentType:'application/json',body:'null'});else await route.continue();});
 await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByTestId('app-shell')).toHaveAttribute('data-hydrated','true');
 await page.getByRole('button',{name:'添加宝宝信息',exact:true}).click();await page.getByRole('textbox',{name:'宝宝姓名',exact:true}).fill('Synthetic UI Create');
 await page.locator('input[type=date]').fill('2025-01-01');const saved=page.waitForResponse(r=>r.url().endsWith('/api/baby')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'保存',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);expect((await response.json()).name).toBe('Synthetic UI Create');
 await page.unroute('**/api/baby');
});
test('profile update and avatar upload are persisted',async({page})=>{
 await page.getByRole('button',{name:'编辑信息 →',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByRole('textbox',{name:'宝宝姓名',exact:true}).fill('Synthetic E2E Edited');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/baby')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'保存',exact:true}).click();expect((await saved).ok()).toBe(true);
 await page.getByRole('button',{name:'更换头像',exact:true}).click();await page.locator('#avatar-upload').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
 const avatar=page.waitForResponse(r=>r.url().endsWith('/api/baby')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'更新头像',exact:true}).click();expect((await avatar).ok()).toBe(true);
 const baby=await page.request.get('/api/baby');expect((await baby.json()).avatar).toMatch(/^\/api\/media\/uploads\//);
});
test('growth calendar create and persisted scoped read',async({page})=>{
 await page.getByRole('button',{name:'成长记录',exact:true}).click();await page.getByRole('button',{name:'添加今日记录'}).click();
 await page.getByPlaceholder('例: 7.5').fill('10.5');await page.getByPlaceholder('记录一些备注信息...').fill('synthetic-playwright-growth');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/growth-records')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'添加记录',exact:true}).click();expect((await saved).status()).toBe(201);
 const list=await page.request.get('/api/growth-records?babyId=e2e-baby');const row=(await list.json()).find((r:any)=>r.notes==='synthetic-playwright-growth');expect(row).toBeTruthy();
 await page.getByTestId(`growth-day-${row.date.split('T')[0]}`).click();await page.getByPlaceholder('例: 7.5').fill('11');
 const updated=page.waitForResponse(r=>r.url().endsWith('/api/growth-records/'+row.id)&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'更新记录',exact:true}).click();expect((await updated).ok()).toBe(true);
 await page.getByTestId(`growth-day-${row.date.split('T')[0]}`).click();await page.getByTitle('删除记录',{exact:true}).click();
 const deleted=page.waitForResponse(r=>r.url().endsWith('/api/growth-records/'+row.id)&&r.request().method()==='DELETE');
 await page.getByRole('button',{name:'确认',exact:true}).click();expect((await deleted).ok()).toBe(true);
});
test('milestone create edit delete through UI',async({page})=>{
 const name='synthetic-playwright-'+Date.now();await page.getByRole('button',{name:'随心记',exact:true}).click();
 await page.getByRole('button',{name:'添加记录',exact:true}).click();await page.getByPlaceholder('标题',{exact:true}).fill(name);
 await page.getByPlaceholder('详细内容').fill('synthetic notes');await page.getByPlaceholder('例: 日记, 运动发展, 翻身, 里程碑').fill('synthetic');
 await page.getByRole('button',{name:'添加',exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 const card=page.locator('div.card').filter({has:page.getByRole('heading',{name,exact:true})});
 await card.getByTitle('编辑',{exact:true}).click();await page.getByPlaceholder('标题',{exact:true}).fill(name+'-edited');
 await page.getByRole('button',{name:'更新',exact:true}).click();await expect(page.getByRole('heading',{name:name+'-edited',exact:true})).toBeVisible();
 page.once('dialog',d=>d.accept());await page.locator('div.card').filter({has:page.getByRole('heading',{name:name+'-edited',exact:true})}).getByTitle('删除',{exact:true}).click();
 await expect(page.getByRole('heading',{name:name+'-edited',exact:true})).toHaveCount(0);
});
test('image R2 direct upload and authenticated view',async({page})=>{
 await gallery(page);await page.locator('input[type=file]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);
 const row=await response.json();const image=await page.request.get(row.url);expect(image.status()).toBe(200);expect(await image.body()).toEqual(png);
 await expect(page.getByRole('heading',{name:'上传媒体文件',exact:true})).toHaveCount(0);
 await page.getByTestId(`media-card-${row.id}`).click();await page.getByTitle('编辑媒体信息',{exact:true}).click();
 await page.getByPlaceholder('输入标题...').fill('Synthetic edited photo');
 const updated=page.waitForResponse(r=>r.url().endsWith('/api/photos/'+row.id)&&r.request().method()==='PUT');
 await page.getByTitle('保存修改',{exact:true}).click();expect((await updated).ok()).toBe(true);
 page.once('dialog',d=>d.accept());const deleted=page.waitForResponse(r=>r.url().endsWith('/api/photos/'+row.id)&&r.request().method()==='DELETE');
 await page.getByTitle('删除媒体文件',{exact:true}).click();expect((await deleted).ok()).toBe(true);
});
test('lost metadata response recovers without duplicate media',async({page})=>{
 let id:string|undefined,dropped=false;await page.route('**/api/photos',async route=>{
  if(route.request().method()!=='POST'||dropped)return route.continue();
  dropped=true;const response=await route.fetch();id=(await response.json()).id;await route.abort('failed');
 });
 await gallery(page);await page.locator('input[type=file]').setInputFiles({name:'retry.png',mimeType:'image/png',buffer:png});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();await expect(page.getByText(/✗/).filter({hasText:/Failed to fetch|网络|上传失败/})).toBeVisible();
 const replay=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await replay;
 expect(response.status()).toBe(200);expect((await response.json()).id).toBe(id);
 const list=await page.request.get('/api/photos?babyId=e2e-baby');expect((await list.json()).items.filter((r:any)=>r.id===id)).toHaveLength(1);
});
test('HEIC sample decodes to real JPEG and displays',async({page})=>{
 await gallery(page);await page.locator('input[type=file]').setInputFiles('.migration/fixtures/example.heic');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST',{timeout:45000});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);
 const row=await response.json();expect(row.format).toBe('jpg');const image=await page.request.get(row.url,{maxRetries:2});expect(image.headers()['content-type']).toBe('image/jpeg');
 expect((await image.body()).subarray(0,2).toString('hex')).toBe('ffd8');
 const img=page.locator(`img[src$="${row.url}"]`).first();await img.scrollIntoViewIfNeeded();await expect(img).toBeVisible();await expect.poll(()=>img.evaluate((i:HTMLImageElement)=>i.naturalWidth)).toBeGreaterThan(0);
});
test('corrupt MOV fails without saving a false success',async({page})=>{
 test.setTimeout(90000);
 let saves=0;page.on('request',r=>{if(r.url().endsWith('/api/photos')&&r.method()==='POST')saves++;});
 await gallery(page);await page.locator('input[type=file]').setInputFiles({name:'unsupported.mov',mimeType:'video/quicktime',buffer:Buffer.from('synthetic-invalid-mov')});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();await expect(page.locator('p').filter({hasText:/✗/})).toBeVisible({timeout:75000});
 await expect(page.getByRole('button',{name:'上传 1 个文件',exact:true})).toBeEnabled();expect(saves).toBe(0);
});
test('H264 MP4 passthrough keeps exact bytes, duration and playable modal',async({page})=>{
 await gallery(page);await page.locator('input[type=file]').setInputFiles('.migration/fixtures/flower.mp4');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST',{timeout:45000});
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);const row=await response.json();
 expect(row.format).toBe('mp4');expect(row.duration).toBeGreaterThan(0);expect(row.thumbnailUrl).toBeTruthy();
 const video=await page.request.get(row.url);expect((await video.body()).equals(readFileSync('.migration/fixtures/flower.mp4'))).toBe(true);
 await page.getByTestId(`media-card-${row.id}`).click();const player=page.locator('video').last();await expect(player).toBeVisible();
 await player.evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});await expect.poll(()=>player.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0.1);
});
test('browser WebM upload stores a decoded JPEG poster and playable private video',async({page})=>{
 await gallery(page);await page.locator('input[type=file]').setInputFiles('.migration/synthetic.webm');
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/photos')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'上传 1 个文件',exact:true}).click();const response=await saved;expect(response.status()).toBe(201);
 const row=await response.json();expect(row.mediaType).toBe('VIDEO');expect(row.thumbnailUrl).toBeTruthy();
 const poster=await page.request.get(row.thumbnailUrl);expect(poster.status()).toBe(200);expect(poster.headers()['content-type']).toBe('image/jpeg');
 const range=await page.request.get(row.url,{headers:{range:'bytes=0-31'}});expect(range.status()).toBe(206);expect((await range.body()).length).toBe(32);
});
