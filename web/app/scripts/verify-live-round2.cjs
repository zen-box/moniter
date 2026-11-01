/* Read-only validation of the deployed local server. No sign-in or data writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require('C:/Users/78646/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'.ui-review'),origin='http://127.0.0.1:8080';
(async()=>{
 const before=JSON.parse(fs.readFileSync(path.join(output,'round2-backup.json'),'utf8'));
 const db=new DatabaseSync(path.join(root,'data/probe.db'),{readOnly:true});
 const metadata={siteName:db.prepare("SELECT value FROM settings WHERE key='site_name'").get().value,
   servers:db.prepare('SELECT COUNT(*) n FROM servers').get().n,targets:db.prepare('SELECT COUNT(*) n FROM monitor_targets').get().n,
   sessions:db.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n};db.close();
 for(const key of ['siteName','servers','targets','sessions'])assert.equal(metadata[key],before[key],key+' changed during upgrade');
 assert.equal(await(await fetch(origin+'/api/v1/ping')).text(),'pong');
 const nodes=await(await fetch(origin+'/api/v1/servers')).json();assert.equal(nodes.length,metadata.servers);
 for(const node of nodes){assert.ok(!('token'in node)&&!('detected_ipv4'in node)&&!('manual_ipv4'in node));if(!node.public_ip){assert.equal(node.ipv4,'');assert.equal(node.ipv6,'')}}
 assert.equal((await fetch(origin+'/api/v1/admin/status')).status,401);
 const htmlResponse=await fetch(origin+'/admin/login'),html=await htmlResponse.text();assert.equal(htmlResponse.headers.get('cache-control'),'no-store');
 const assets=Array.from(html.matchAll(/(?:src|href)="(\/ui-assets\/[^" ]+\.(?:js|css))"/g),m=>m[1]);assert.ok(assets.length>=2);
 for(const url of assets){const response=await fetch(origin+url,{headers:{'Accept-Encoding':'gzip'}});assert.equal(response.status,200);assert.ok(response.headers.get('cache-control').includes('immutable'));assert.equal(response.headers.get('content-encoding'),'gzip');await response.arrayBuffer()}
 const downloads=[];
 for(const [platform,machine]of [['linux-amd64',62],['linux-arm64',183],['windows-amd64',null]]){
  const response=await fetch(origin+'/download/agent/'+platform);assert.equal(response.status,200);const file=Buffer.from(await response.arrayBuffer());
  if(machine){assert.deepEqual([...file.subarray(0,4)],[127,69,76,70]);assert.equal(file[4],2);assert.equal(file[5],1);assert.equal(file.readUInt16LE(18),machine);
   const at=Number(file.readBigUInt64LE(32)),step=file.readUInt16LE(54),count=file.readUInt16LE(56);for(let i=0;i<count;i++)assert.notEqual(file.readUInt32LE(at+i*step),3,'Linux release requires a dynamic interpreter');
  }else{assert.equal(file.toString('ascii',0,2),'MZ')}
  downloads.push({platform,bytes:file.length,format:machine?'ELF64 static':'PE'});
 }
 const browser=await chromium.launch({headless:true,executablePath:'C:/Users/78646/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'});
 const errors=[];let samples=0;
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
  await context.addInitScript(()=>{localStorage.setItem('aegis_theme','dark');localStorage.setItem('aegis_lang','zh');window.__frames=[];let count=0;function frame(){const brand=document.querySelector('.login-card h1,.brand strong,.mp-brand strong');window.__frames.push({title:document.title,brand:brand?.textContent||''});if(++count<180)requestAnimationFrame(frame)}requestAnimationFrame(frame)});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  for(let attempt=0;attempt<2;attempt++){
   if(attempt)await page.reload({waitUntil:'networkidle'});else await page.goto(origin+'/admin/login',{waitUntil:'networkidle'});
   await page.locator('.login-card h1').waitFor();await page.waitForTimeout(500);
   const frames=await page.evaluate(()=>window.__frames);samples+=frames.length;assert.ok(frames.every(f=>f.title.includes(metadata.siteName)&&(!f.brand||f.brand===metadata.siteName)));assert.ok((await page.title()).includes(metadata.siteName));
  }
  await page.screenshot({path:path.join(output,'round2-live-login.png')});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.login-tools').evaluate(el=>{const a=el.firstElementChild.getBoundingClientRect(),b=el.lastElementChild.getBoundingClientRect();return Math.abs(a.top-b.top)<2&&a.right<=b.left}),'Language and appearance controls must share one row');
  await page.screenshot({path:path.join(output,'round2-live-login-mobile.png')});
  await page.goto(origin,{waitUntil:'networkidle'});await page.locator('.mp-node').first().waitFor();assert.equal(await page.locator('.mp-node').count(),metadata.servers);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(nodes.every(n=>n.status!=='online'))assert.equal(await page.locator('.mp-summary > div').last().locator('strong').textContent(),'—');
  await page.screenshot({path:path.join(output,'round2-live-public-mobile.png')});
 }finally{await browser.close()}
 assert.deepEqual(errors,[]);
 const report={status:'passed',metadata,downloads,compressedAssets:assets.length,coldCacheReloads:2,sampledFrames:samples,browserErrors:errors};fs.writeFileSync(path.join(output,'round2-live-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1});
