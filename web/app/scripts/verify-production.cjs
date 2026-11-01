/* Runs against an isolated server and database, never the user's :8080 data. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");
const { chromium } = require("C:/Users/78646/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(__dirname, "../../..");
const output = path.join(root, ".ui-review");
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, "production-fixture-"));
const password = "Fixture-Only!45-not-a-user-password";
let server, browser, origin, session, receiver, agent;
const failures = [];
const passed = [];
async function check(name, run) { await run(); passed.push(name); }
async function api(url, init = {}) {
  const response = await fetch(origin + url, { ...init, headers: { Authorization: `Bearer ${session}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const data = await response.json();
  assert.ok(response.ok, `API status ${response.status} at ${url}`);
  return data;
}
function zip(files) {
  const chunks = [], directory = []; let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const filename = Buffer.from(name), bytes = Buffer.from(contents), compressed = zlib.deflateRawSync(bytes);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8); local.writeUInt32LE(crc,14); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(filename.length,26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10); central.writeUInt32LE(crc,16); central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(bytes.length,24); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
    chunks.push(local, filename, compressed); directory.push(central, filename); offset += local.length + filename.length + compressed.length;
  }
  const entries = Object.keys(files).length, index = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries,8); end.writeUInt16LE(entries,10); end.writeUInt32LE(index.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,index,end]);
}
async function upload(name, files, replace=false) {
  const body = new FormData(); body.set("file", new Blob([zip(files)]), name);
  return (await fetch(origin + `/api/v1/admin/themes/upload?replace=${replace}`, { method:"POST", headers:{Authorization:`Bearer ${session}`}, body })).json();
}
async function start(port) {
  const env = {...process.env, MONITER_UPDATE_CHECK:"0", AEGIS_BIND:`127.0.0.1:${port}`, AEGIS_DB_PATH:path.join(fixture,"fixture.db"), AEGIS_ADMIN_PASSWORD:password, AEGIS_TRUST_PROXY:"0"};
  delete env.AEGIS_PUBLIC_URL;
  server = spawn(process.env.MONITER_TEST_SERVER || path.join(root, "target-review/debug/aegis-server.exe"), [], {cwd:fixture, env, windowsHide:true, stdio:["ignore","pipe","pipe"]});
  server.stdout.on("data",()=>{}); server.stderr.on("data",()=>{});
  server.on("error",error=>failures.push(error.message));
  for (let i=0;i<100;i++) { if(server.exitCode!==null) throw Error("Isolated server exited before readiness"); try { const r=await fetch(origin+"/api/v1/ping"); if(r.ok)return; } catch{} await new Promise(r=>setTimeout(r,100)); }
  throw Error("Isolated server did not become ready");
}
async function stop() { if(!server || server.exitCode!==null)return; await new Promise(resolve=>{server.once("exit",resolve);server.kill();}); }
(async()=>{
  fs.mkdirSync(fixture,{recursive:true}); fs.mkdirSync(path.join(fixture,"web"),{recursive:true});
  if(fs.existsSync(path.join(fixture,"fixture.db")))throw Error("Choose a fresh fixture directory; an existing test database will not be overwritten");
  fs.cpSync(path.join(root,"web/dist"),path.join(fixture,"web/dist"),{recursive:true});
  fs.cpSync(path.join(root,"web/assets"),path.join(fixture,"web/assets"),{recursive:true});
  fs.mkdirSync(path.join(fixture,"web/themes/default"),{recursive:true});
  fs.copyFileSync(path.join(root,"web/themes/default/world-map-paths.svg"),path.join(fixture,"web/themes/default/world-map-paths.svg"));
  const listener=net.createServer(); await new Promise(r=>listener.listen(0,"127.0.0.1",r)); const port=listener.address().port; await new Promise(r=>listener.close(r)); origin=`http://127.0.0.1:${port}`;
  await start(port);
  await check("administrative endpoints reject anonymous callers",async()=>{for(const route of ["status","servers","themes","alerts","site-settings","updates"]){assert.equal((await fetch(origin+"/api/v1/admin/"+route)).status,401);} assert.equal((await fetch(origin+"/api/v1/admin/updates/check",{method:"POST"})).status,401);});
  const login=await api("/api/v1/admin/login",{method:"POST",body:JSON.stringify({username:"admin",password})}); assert.equal(login.success,true); session=login.token;
  await check("version APIs expose package version and respect disabled checks",async()=>{for(const [route,method] of [["updates","GET"],["updates/check","POST"]]){const status=await api("/api/v1/admin/"+route,{method});assert.equal(status.current_version,"0.1.0");assert.equal(status.enabled,false);assert.equal(status.checked_at,null);assert.equal(status.update_available,false);}});
  await check("administration refuses opaque origins even with a valid fixture session",async()=>{assert.equal((await fetch(origin+"/api/v1/admin/status",{headers:{Authorization:`Bearer ${session}`,Origin:"null"}})).status,403);});
  const node=await api("/api/v1/admin/servers/add",{method:"POST",body:JSON.stringify({name:"Production fixture",tags:"test"})}); assert.equal(node.success,true);
  await check("node edits persist addresses and legacy callers preserve optional settings",async()=>{
    const item=(await api("/api/v1/admin/servers"))[0];
    assert.equal((await api("/api/v1/admin/servers/update",{method:"POST",body:JSON.stringify({...item,ipv4:"192.0.2.8",ipv6:"2001:db8::8",traffic_type:"both",traffic_reset_day:15,monitor_mode:"selected",monitor_targets:"1,2"})})).success,true);
    const legacy={...item};for(const key of ["ipv4","ipv6","traffic_type","traffic_reset_day","monitor_mode","monitor_targets"])delete legacy[key];
    assert.equal((await api("/api/v1/admin/servers/save",{method:"POST",body:JSON.stringify(legacy)})).success,true);
    const saved=(await api("/api/v1/admin/servers"))[0];assert.equal(saved.ipv4,"192.0.2.8");assert.equal(saved.ipv6,"2001:db8::8");assert.equal(saved.traffic_type,"both");assert.equal(saved.traffic_reset_day,15);assert.equal(saved.monitor_mode,"selected");assert.equal(saved.monitor_targets,"1,2");
    assert.equal((await api("/api/v1/admin/servers/update",{method:"POST",body:JSON.stringify({...saved,ipv4:"not-an-ip"})})).success,false);
  });
  await check("installation validates node credentials and quotes script values",async()=>{
    for(const ext of ["sh","ps1"]){
      assert.equal((await fetch(origin+`/install.${ext}?token=`+encodeURIComponent('AUDIT"QUOTE'))).status,400);
      assert.equal((await fetch(origin+`/install.${ext}?token=`+"a".repeat(32))).status,401);
      const response=await fetch(origin+`/install.${ext}`,{headers:{Authorization:`Bearer ${node.token}`,"x-forwarded-proto":'https"bad'}}); assert.equal(response.status,200);const script=await response.text(); assert.ok(script.includes(`'${node.token}'`));assert.ok(script.includes(`'${origin}'`));
    }
  });
  await check("security headers and public-only CORS",async()=>{
    const response=await fetch(origin+"/admin"); assert.equal(response.headers.get("x-frame-options"),"DENY"); assert.equal(response.headers.get("x-content-type-options"),"nosniff");assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal((await fetch(origin+"/api/v1/servers")).headers.get("access-control-allow-origin"),"*"); assert.equal((await fetch(origin+"/api/v1/admin/status")).headers.get("access-control-allow-origin"),null);
  });
  await check("theme upload rejects archive traversal",async()=>{const result=await upload("bad-theme.zip",{"../outside.txt":"bad","index.html":"<html></html>"}); assert.equal(result.success,false);assert.equal(fs.existsSync(path.join(fixture,"web/outside.txt")),false);});
  const imported=await upload("isolated-theme.zip",{
    "index.html":'<!doctype html><html><head><link rel="stylesheet" href="./assets/style.css"></head><body><h1 id="theme-title">Isolated theme</h1><script type="module" src="./assets/app.js"></script></body></html>',
    "assets/style.css":"body{font:16px system-ui;background:#f4f5f7}h1{color:rgb(40,80,120)}",
    "assets/app.js":`const result={storage:localStorage.getItem('aegis_admin_token'),parentBlocked:false};try{result.parent=parent.localStorage.getItem('aegis_admin_token')}catch{result.parentBlocked=true}result.nodes=(await(await fetch('/api/v1/servers')).json()).length;result.saved=localStorage.getItem('theme-color');localStorage.setItem('theme-color','purple');window.__themeResult=result;document.body.dataset.ready='true';`,
  }); assert.equal(imported.success,true);
  await api("/api/v1/admin/theme/switch",{method:"POST",body:JSON.stringify({theme_id:imported.theme.id})});
  browser=await chromium.launch({headless:true,executablePath:"C:/Users/78646/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:"zh-CN",timezoneId:"Asia/Shanghai"});
  await context.addInitScript(token=>{if (window.top === window) {localStorage.setItem("aegis_admin_token",token);if(!localStorage.getItem("aegis_lang"))localStorage.setItem("aegis_lang","zh")}},session);
  const page=await context.newPage();const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await check("version settings handle updates, manual checks, mobile layout and both languages",async()=>{
    await page.goto(origin+"/admin#settings",{waitUntil:"networkidle"});
    const settings=page.getByTestId("version-settings");await settings.getByText("v0.1.0",{exact:true}).waitFor();
    assert.equal(await settings.getByRole("button",{name:"检查更新",exact:true}).isDisabled(),true);
    assert.equal(await page.locator(".update-notice").count(),0);
    let status={current_version:"0.1.0",latest_version:"0.2.0",enabled:true,update_available:true,release_url:"https://github.com/zen-box/moniter/releases/tag/v0.2.0",checked_at:1793520000,last_attempt_at:1793520000,error:null};
    await page.route("**/api/v1/admin/updates",route=>route.fulfill({json:status}));
    await page.route("**/api/v1/admin/updates/check",route=>{status={...status,latest_version:"0.3.0",release_url:"https://github.com/zen-box/moniter/releases/tag/v0.3.0"};return route.fulfill({json:status})});
    try{
      await page.reload({waitUntil:"networkidle"});await page.getByRole("link",{name:"新版本 0.2.0",exact:true}).waitFor();
      await settings.getByRole("button",{name:"检查更新",exact:true}).click();await settings.getByRole("link",{name:"查看 v0.3.0",exact:true}).waitFor();
      assert.equal(await settings.getByRole("link",{name:"查看 v0.3.0",exact:true}).getAttribute("href"),status.release_url);
      await page.waitForTimeout(400);await page.screenshot({path:path.join(output,"version-settings-desktop.png"),fullPage:true});
      await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await page.screenshot({path:path.join(output,"version-settings-mobile.png"),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const notice=await page.locator(".update-notice").boundingBox();assert.ok(notice.x>=0&&notice.x+notice.width<=390);
      await page.setViewportSize({width:1440,height:1000});await page.getByRole("button",{name:"切换语言",exact:true}).click();
      await settings.getByRole("heading",{name:"Software updates",exact:true}).waitFor();assert.equal(/[\u4e00-\u9fff]/.test(await settings.innerText()),false);
      status={...status,error:"network"};await page.reload({waitUntil:"networkidle"});await settings.getByRole("alert").filter({hasText:"Could not reach GitHub"}).waitFor();assert.equal(await page.locator(".update-notice").count(),1);
      await page.getByRole("button",{name:"Switch language",exact:true}).click();
    }finally{await page.unroute("**/api/v1/admin/updates");await page.unroute("**/api/v1/admin/updates/check");await page.setViewportSize({width:1440,height:1000})}
  });
  await check("uploaded React-style module theme renders with public API access and isolated storage",async()=>{
    await page.goto(origin,{waitUntil:"networkidle"}); const frame=page.frameLocator("#theme");await frame.locator('body[data-ready="true"]').waitFor();
    const result=await frame.locator("body").evaluate(()=>window.__themeResult);assert.equal(result.storage,null);assert.equal(result.parentBlocked,true);assert.equal(result.nodes,1);
    assert.equal(await frame.locator("h1").evaluate(e=>getComputedStyle(e).color),"rgb(40, 80, 120)");
    await page.waitForTimeout(100);await page.reload({waitUntil:"networkidle"});await frame.locator('body[data-ready="true"]').waitFor();assert.equal(await frame.locator("body").evaluate(()=>window.__themeResult.saved),"purple");
    await page.screenshot({path:path.join(output,"fixed-theme-sandbox.png")});
    assert.ok((await fetch(origin+`/themes/${imported.theme.id}/index.html`)).headers.get("content-security-policy").includes("sandbox allow-scripts"));
  });
  await check("isolated theme supports direct hash links and persistent preferences",async()=>{
    await page.goto(origin+"/#detail/fixture",{waitUntil:"networkidle"});const frame=page.frameLocator("#theme");await frame.locator('body[data-ready="true"]').waitFor({timeout:6000});assert.equal(await frame.locator("body").evaluate(()=>window.__themeResult.saved),"purple");assert.equal(await frame.locator("body").evaluate(()=>location.hash),"#detail/fixture");
  });
  await api("/api/v1/admin/theme/switch",{method:"POST",body:JSON.stringify({theme_id:"default"})});
  await check("theme updates require explicit replacement and inactive themes can be deleted",async()=>{
    const themeDir=path.join(fixture,"web/themes",imported.theme.id),files={};
    for(const filename of ["index.html","assets/style.css","assets/app.js","theme.json"])files[filename]=fs.readFileSync(path.join(themeDir,filename),"utf8");
    assert.equal((await upload("same-id.zip",files)).success,false);
    assert.equal((await upload("same-id.zip",files,true)).success,true);
    const broken={...files,"theme.json":JSON.stringify({...imported.theme,entry:"../outside.html"})};assert.equal((await upload("same-id.zip",broken,true)).success,false);
    assert.equal(fs.readFileSync(path.join(themeDir,"index.html"),"utf8"),files["index.html"]);
    assert.equal((await api("/api/v1/admin/themes/delete",{method:"POST",body:JSON.stringify({theme_id:imported.theme.id})})).success,true);
    assert.equal((await api("/api/v1/admin/themes/delete",{method:"POST",body:JSON.stringify({theme_id:"default"})})).success,false);
    assert.equal((await api("/api/v1/admin/themes")).themes.some(t=>t.id==="default"),true);
  });

  await check("admin node editor is compact and switches disable with the alert master",async()=>{
    await page.goto(origin+"/admin#nodes",{waitUntil:"networkidle"});await page.getByRole("button",{name:"添加节点",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.waitFor();await page.waitForTimeout(250);const box=await dialog.boundingBox();assert.ok(box.height<700,`Create dialog height=${box.height}`);assert.ok(box.y>=0&&box.y+box.height<=1000);assert.equal(await dialog.getByRole("switch",{name:"离线告警",exact:true}).isDisabled(),true);await dialog.getByRole("switch",{name:"接收节点告警",exact:true}).click();assert.equal(await dialog.getByRole("switch",{name:"离线告警",exact:true}).isDisabled(),false);await page.screenshot({path:path.join(output,"fixed-node-create.png"),fullPage:true});await page.keyboard.press("Escape");
  });
  await check("English create and edit dialogs fit mobile and retain advanced settings",async()=>{
    const mobile=await browser.newContext({viewport:{width:390,height:844},locale:"en-US",reducedMotion:"reduce"});
    try {
      await mobile.addInitScript(token=>{localStorage.setItem("aegis_admin_token",token);localStorage.setItem("aegis_lang","en")},session);const tab=await mobile.newPage();tab.on("pageerror",error=>errors.push(error.message));await tab.goto(origin+"/admin#nodes",{waitUntil:"networkidle"});
      for(const create of [true,false]){
        await tab.getByRole("button",{name:create?"Add node":"Edit",exact:true}).click();const dialog=tab.getByRole("dialog");await dialog.waitFor();const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391&&box.y>=0&&box.y+box.height<=845,`Mobile dialog outside viewport: ${JSON.stringify(box)}`);
        const footer=dialog.getByRole("button",{name:"Save node",exact:true});const footerBox=await footer.boundingBox();assert.ok(footerBox.y>=0&&footerBox.y+footerBox.height<=845,"Footer cannot be reached");
        if(!create){await dialog.getByRole("spinbutton",{name:"Monthly traffic reset day"}).scrollIntoViewIfNeeded();assert.equal(await dialog.getByRole("spinbutton",{name:"Monthly traffic reset day"}).inputValue(),"15");await dialog.locator(".node-modal-body").evaluate(element=>element.scrollTop=element.scrollHeight);assert.equal(await dialog.locator(".node-modal-body").evaluate(element=>element.scrollWidth>element.clientWidth),false);await tab.screenshot({path:path.join(output,"fixed-node-edit-mobile.png")});}
        assert.equal(/[\u4e00-\u9fff]/.test((await dialog.locator('[data-slot="label"]').allTextContents()).join(" ")),false,"English dialog contains Chinese field labels");await tab.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
      }
    }finally{await mobile.close()}
  });
  await check("page navigation never fades the content out, including reduced motion",async()=>{
    for(const [reducedMotion,label] of [["no-preference","安全审计"],["reduce","节点管理"]]){
      await page.emulateMedia({reducedMotion});await page.evaluate(()=>{window.__samples=[];window.__sample=true;function sample(){const e=document.querySelector('.page-transition');if(e)window.__samples.push(Number(getComputedStyle(e).opacity));if(window.__sample)requestAnimationFrame(sample)}requestAnimationFrame(sample)});
      await page.locator(".sidebar-nav button").filter({hasText:label}).click();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>{window.__sample=false;return Math.min(...window.__samples)}),1);
    }
  });
  await check("admin failed refresh preserves rows and displays retry without unhandled errors",async()=>{
    await page.goto(origin+"/admin#nodes",{waitUntil:"networkidle"});const before=await page.locator(".data-table tbody tr").count();let fail=true;await page.route("**/api/v1/admin/servers",route=>fail?route.fulfill({status:503,body:"unavailable"}):route.continue());await page.evaluate(()=>dispatchEvent(new Event("antox:refresh")));await page.getByRole("alert").filter({hasText:"更新失败"}).waitFor();assert.equal(await page.locator(".data-table tbody tr").count(),before);fail=false;await page.getByRole("button",{name:"重试",exact:true}).click();await page.getByRole("alert").filter({hasText:"更新失败"}).waitFor({state:"detached"});
  });

  await check("target manager paginates and searches instead of rendering ninety-three rows",async()=>{
    await page.goto(origin+"/admin#targets",{waitUntil:"networkidle"});await page.locator(".data-table tbody tr").first().waitFor();
    assert.equal(await page.locator(".data-table tbody tr").count(),15);
    await page.getByRole("textbox",{name:"搜索监控目标",exact:true}).fill("he-ct-v4");await page.waitForTimeout(150);assert.equal(await page.locator(".data-table tbody tr").count(),1);
    assert.equal(await page.locator(".data-table tbody tr").getByRole("switch").count(),1);
    await page.screenshot({path:path.join(output,"round2-target-search.png")});
  });
  await check("audit renders local time and marks failed sign-ins distinctly",async()=>{
    await api("/api/v1/admin/login",{method:"POST",body:JSON.stringify({username:"admin",password:"Fixture wrong password"})});
    await page.goto(origin+"/admin#audit",{waitUntil:"networkidle"});const failure=page.locator(".audit-action.is-failure").filter({hasText:"管理员登录失败"});await failure.waitFor();
    assert.equal(await failure.locator("svg.lucide-triangle-alert").count(),1);
    assert.equal(await failure.locator('svg').evaluate(svg=>getComputedStyle(svg).color),await failure.evaluate(el=>getComputedStyle(el).color));
    const time=page.locator("time").first();const iso=await time.getAttribute("datetime");assert.ok(iso.endsWith("Z"));
    const expected=await page.evaluate(iso=>new Date(iso).toLocaleString("zh-CN",{hour12:false}),iso);assert.equal(await time.textContent(),expected);
    await page.screenshot({path:path.join(output,"round2-audit-local-time.png")});
  });
  await check("populated dashboards keep subtitle hierarchy and contain status labels on mobile",async()=>{
    const saved=await api("/api/v1/admin/servers");const visual=saved.flatMap((n,index)=>Array.from({length:6},(_,i)=>({...n,id:`visual-${i}`,name:`Singapore-Production-Long-Name-${i+1}`,provider:"Vultr",status:i%2?"offline":"online",current_cpu:i%2?null:32+i*4,latency_ct:20,latency_cu:30,latency_cm:40,region:"sg",region_name:"新加坡",traffic_used_gb:42,billing_price:3.5,billing_cycle:"monthly",renewal_date:"2026-11-08"})));
    await page.route("**/api/v1/admin/servers",route=>route.fulfill({json:visual}));
    try{
      await page.goto(origin+"/admin#overview",{waitUntil:"networkidle"});await page.evaluate(()=>dispatchEvent(new Event("antox:refresh")));await page.getByText("Singapore-Production-Long-Name-1",{exact:true}).first().waitFor();await page.waitForTimeout(700);
      assert.ok((await page.title()).includes("仪表盘"));assert.ok((await page.locator(".recharts-bar-rectangle").count())>0);
      await page.screenshot({path:path.join(output,"round2-overview-desktop.png"),fullPage:true});
      await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
      const overflow=await page.locator(".health-row").evaluateAll(rows=>rows.some(row=>{const label=row.lastElementChild;return label.getBoundingClientRect().right>row.getBoundingClientRect().right+1}));assert.equal(overflow,false);
      await page.screenshot({path:path.join(output,"round2-overview-mobile.png"),fullPage:true});
      const offenders=await page.locator("body *").evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(e).position!=="fixed"}).slice(0,12).map(e=>({tag:e.tagName,class:e.getAttribute("class"),width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})));if(offenders.length)console.log(JSON.stringify({mobileOverflow:offenders}));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,"round2-overview-mobile.png"),fullPage:true});
      await page.setViewportSize({width:1440,height:1000});await page.goto(origin+"/admin#alerts",{waitUntil:"networkidle"});
      const hierarchy=await page.locator(".alert-channel").evaluateAll(cards=>cards.every(card=>{const h=card.querySelector("h3"),p=card.querySelector('[data-slot="header"] p');return !h||!p||parseFloat(getComputedStyle(h).fontSize)>parseFloat(getComputedStyle(p).fontSize)}));assert.equal(hierarchy,true);
      await page.screenshot({path:path.join(output,"round2-alerts-desktop.png"),fullPage:true});
    }finally{await page.unroute("**/api/v1/admin/servers");await page.setViewportSize({width:1440,height:1000})}
  });
  await check("session survives a server restart",async()=>{await stop();await start(port);assert.equal((await api("/api/v1/admin/status")).logged_in,true)});
  await check("test notifications report success, partial failure and refused redirects",async()=>{
    const received=[];receiver=http.createServer((request,response)=>{let body="";request.on("data",chunk=>body+=chunk);request.on("end",()=>{received.push({path:request.url,body});if(request.url==="/redirect"){response.writeHead(302,{Location:"/should-not-follow"});response.end()}else{response.writeHead(200,{"Content-Type":"application/json"});response.end('{"ok":true}')}})});await new Promise(resolve=>receiver.listen(0,"127.0.0.1",resolve));
    const config={...(await api("/api/v1/admin/alerts")),enabled:false,smtp_enabled:false,telegram_enabled:false,webhook_enabled:true,webhook_url:`http://127.0.0.1:${receiver.address().port}/ok`};
    assert.equal((await api("/api/v1/admin/alerts/save",{method:"POST",body:JSON.stringify(config)})).success,true);const success=await api("/api/v1/admin/alerts/test",{method:"POST"});assert.equal(success.success,true);assert.deepEqual(success.sent,["Webhook"]);assert.equal(JSON.parse(received[0].body).source,"Moniter");
    await api("/api/v1/admin/alerts/save",{method:"POST",body:JSON.stringify({...config,smtp_enabled:true,smtp_host:"",from:"",to:""})});const partial=await api("/api/v1/admin/alerts/test",{method:"POST"});assert.equal(partial.success,false);assert.deepEqual(partial.sent,["Webhook"]);assert.ok(partial.errors.length>0);
    await api("/api/v1/admin/alerts/save",{method:"POST",body:JSON.stringify({...config,webhook_url:config.webhook_url.replace("/ok","/redirect")})});assert.equal((await api("/api/v1/admin/alerts/test",{method:"POST"})).success,false);assert.equal(received.some(item=>item.path==="/should-not-follow"),false);await new Promise(resolve=>receiver.close(resolve));receiver=null;
  });
  await check("resetting a node token revokes an established agent connection",async()=>{
    const socket=new WebSocket(origin.replace("http","ws")+"/ws/agent");await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
    const reply=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Fixture agent did not authenticate")),4000);socket.onmessage=event=>{clearTimeout(timer);resolve(JSON.parse(event.data))}});socket.send(JSON.stringify({token:node.token,type:"get_targets"}));assert.equal((await reply).type,"targets");
    const reset=await api("/api/v1/admin/servers/reset_token",{method:"POST",body:JSON.stringify({id:node.id})});assert.equal(reset.success,true);
    const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error("Old agent remained authenticated"))},4000);socket.onclose=()=>{clearTimeout(timer);resolve()}});socket.send(JSON.stringify({type:"get_targets"}));await closed;
    assert.equal((await fetch(origin+"/install.sh",{headers:{Authorization:`Bearer ${node.token}`}})).status,401);assert.equal((await fetch(origin+"/install.sh",{headers:{Authorization:`Bearer ${reset.token}`}})).status,200);
    node.token=reset.token;
  });
  await check("release agent reports real system metrics and disconnects cleanly",async()=>{
    agent=spawn(process.env.MONITER_TEST_AGENT || path.join(root,"target-review/release/aegis-agent.exe"),["--server",origin.replace("http","ws")+"/ws/agent"],{cwd:fixture,env:{...process.env,AEGIS_AGENT_TOKEN:node.token},windowsHide:true,stdio:"ignore"});
    let online=false;
    for(let i=0;i<100;i++){if(agent.exitCode!==null)throw Error("Fixture agent stopped unexpectedly");const nodes=await(await fetch(origin+"/api/v1/servers")).json();if(nodes[0].status==="online"&&nodes[0].mem_total_mb>0&&nodes[0].cpu_cores>0){online=true;break}await new Promise(resolve=>setTimeout(resolve,150))}
    assert.equal(online,true,"Agent metrics did not arrive");await new Promise(resolve=>{agent.once("exit",resolve);agent.kill()});agent=null;
    let offline=false;for(let i=0;i<40;i++){if((await(await fetch(origin+"/api/v1/servers")).json())[0].status==="offline"){offline=true;break}await new Promise(resolve=>setTimeout(resolve,100))}assert.equal(offline,true);
  });
  await check("idle unauthenticated agent is disconnected within the authentication deadline",async()=>{const socket=new WebSocket(origin.replace("http","ws")+"/ws/agent");await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error("Unauthenticated agent stayed open"))},7500);socket.onclose=()=>{clearTimeout(timer);resolve()};socket.onerror=()=>{};})});
  await check("logout revokes the fixture session",async()=>{assert.equal((await api("/api/v1/admin/logout",{method:"POST"})).success,true);assert.equal((await fetch(origin+"/api/v1/admin/status",{headers:{Authorization:`Bearer ${session}`}})).status,401)});
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  const report={status:"passed",checks:passed,browserErrors:errors};fs.writeFileSync(path.join(output,"production-result-2026-11-01.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{if(agent&&agent.exitCode===null)await new Promise(resolve=>{agent.once("exit",resolve);agent.kill()});if(browser)await browser.close();if(receiver)await new Promise(resolve=>receiver.close(resolve));await stop();if(path.dirname(fixture)===output&&/^production-fixture-[A-Za-z0-9]{6}$/.test(path.basename(fixture)))fs.rmSync(fixture,{recursive:true,force:true})});
