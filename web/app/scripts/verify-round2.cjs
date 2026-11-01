/* Business regressions: isolated SQLite, loopback server, local Webhook and Agent. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const {spawn}=require('node:child_process');const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'.ui-review');
const fixture=fs.mkdtempSync(path.join(output,'round2-fixture-')),dbPath=path.join(fixture,'fixture.db');
const password='Round2-fixture-only!7-zX';let server,agent,receiver,origin,session,port;
const peers=new Set(),events=[],passed=[],measurements={};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,limit=12000){const start=Date.now();while(Date.now()-start<limit){if(await test())return;await sleep(150)}throw Error('Timed out waiting for fixture condition')}
async function check(name,fn){await fn();passed.push(name);console.log('PASS '+name)}
async function api(url,body,anonymous=false){const response=await fetch(origin+url,{method:body?'POST':'GET',headers:{...(!anonymous&&session?{Authorization:`Bearer ${session}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200,`${url}: HTTP ${response.status}`);return response.json()}
async function start(){const env={...process.env,MONITER_UPDATE_CHECK:'0',AEGIS_BIND:`127.0.0.1:${port}`,AEGIS_DB_PATH:dbPath,AEGIS_ADMIN_PASSWORD:password,AEGIS_TRUST_PROXY:'0'};delete env.AEGIS_PUBLIC_URL;
 server=spawn(process.env.MONITER_TEST_SERVER||path.join(root,'target-review/debug/aegis-server.exe'),[],{cwd:fixture,env,windowsHide:true,stdio:'ignore'});
 await until(async()=>{if(server.exitCode!==null)throw Error('Fixture server exited');try{return(await fetch(origin+'/api/v1/ping')).ok}catch{return false}})}
async function stop(){if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill();await done}}
function addPeer(token,counters={rx:100000,tx:50000}){return new Promise((resolve,reject)=>{
 const socket=new WebSocket(origin.replace('http','ws')+'/ws/agent');let timer;const peer={socket,counters,close(){clearInterval(timer);peers.delete(peer);socket.close()}};
 socket.addEventListener('error',reject,{once:true});socket.addEventListener('open',()=>{
  socket.send(JSON.stringify({token}));
  const send=()=>{if(socket.readyState===1)socket.send(JSON.stringify({stats:{cpu_usage:42,mem_used_bytes:1073741824,mem_total_bytes:2147483648,total_rx_bytes:counters.rx,total_tx_bytes:counters.tx,uptime_secs:100,os_name:'Fixture OS',...counters.stats},agent_version:'round2-fixture',latency_source:'sh-zstatic-tcp80-v1',latency:{ct_ms:20,cu_ms:30,cm_ms:40}}))};
  send();timer=setInterval(send,400);peers.add(peer);resolve(peer);
 });socket.addEventListener('close',()=>clearInterval(timer));
})}
async function node(id){return(await api('/api/v1/admin/servers')).find(n=>n.id===id)}
async function configure(id,patch){const previous=await node(id);const result=await api('/api/v1/admin/servers/update',{...previous,...patch});assert.equal(result.success,true)}
async function alertConfig(patch={}){const current=await api('/api/v1/admin/alerts');return api('/api/v1/admin/alerts/save',{...current,...patch})}
async function main(){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));port=listener.address().port;await new Promise(r=>listener.close(r));origin=`http://127.0.0.1:${port}`;
 fs.mkdirSync(path.join(fixture,'web'),{recursive:true});fs.cpSync(path.join(root,'web/dist'),path.join(fixture,'web/dist'),{recursive:true});
 await start();const login=await api('/api/v1/admin/login',{username:'admin',password});assert.equal(login.success,true);session=login.token;
 const created=await api('/api/v1/admin/servers/add',{name:'Round2-live'});const history=await api('/api/v1/admin/servers/add',{name:'Round2-history'});
 await configure(created.id,{monitor_enabled:true,alert_enabled:true,alert_offline:true,alert_traffic:true});
 receiver=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{events.push(JSON.parse(body));res.end('{"ok":true}')})});await new Promise(r=>receiver.listen(0,'127.0.0.1',r));
 await alertConfig({enabled:true,webhook_enabled:true,webhook_url:`http://127.0.0.1:${receiver.address().port}`,notify_offline:true,notify_online:true});
 let first=await addPeer(created.token);await until(async()=>(await node(created.id)).status==='online');
 await check('normal Agent disconnect and repeated state transitions deliver both offline alerts',async()=>{
  for(let round=0;round<2;round++){
   first.close();await until(()=>events.filter(e=>e.title.includes('离线告警')).length===round+1,8000);
   first=await addPeer(created.token);await until(()=>events.filter(e=>e.title.includes('恢复告警')).length===round+1,8000);
  }
  assert.equal(events.filter(e=>e.title.includes('离线告警')).length,2);assert.equal(events.filter(e=>e.title.includes('恢复告警')).length,2);
 });
 await check('closing a superseded socket cannot mark the replacement offline',async()=>{
  const before=events.length,newer=await addPeer(created.token);await sleep(800);first.close();first=newer;await sleep(4000);assert.equal((await node(created.id)).status,'online');assert.equal(events.length,before);
 });
 await check('manual addresses survive heartbeats and public outputs hide IP by default',async()=>{
  await configure(created.id,{ipv4:'192.0.2.8',ipv6:'2001:db8::8'});await sleep(1100);assert.equal((await node(created.id)).ipv4,'192.0.2.8');
  const publicNodes=await api('/api/v1/servers',null,true);assert.equal(publicNodes.find(n=>n.id===created.id).ipv4,'');
  const page=await fetch(origin+'/');assert.equal(page.status,200);const text=await page.text();assert.ok(!text.includes('192.0.2.8')&&!text.includes('2001:db8::8'),'Initial React snapshot exposes IP');assert.equal((await fetch(origin+'/data.js')).status,404);
  const payload=await new Promise((resolve,reject)=>{const socket=new WebSocket(origin.replace('http','ws')+'/ws/client');const timer=setTimeout(()=>{socket.close();reject(Error('No viewer snapshot'))},4000);socket.addEventListener('message',e=>{clearTimeout(timer);socket.close();resolve(JSON.parse(e.data))},{once:true})});assert.equal(payload.find(n=>n.id===created.id).ipv4,'');
  await configure(created.id,{public_ip:true});assert.equal((await api('/api/v1/servers',null,true)).find(n=>n.id===created.id).ipv4,'192.0.2.8');await configure(created.id,{public_ip:false});
 });
 await check('admin overview receives live CPU and carrier latency',async()=>{const n=await node(created.id);assert.equal(n.current_cpu,42);assert.equal(n.latency_ct,20)});
 await check('resource, TCP failure and offline renewal rules honor per-node switches and deduplicate',async()=>{
  const resource=await api('/api/v1/admin/servers/add',{name:'Round2-resource',alert_enabled:true,monitor_enabled:true,alert_rules:{memory:true,disk:true,load:true,loss:true}});
  const quiet=await api('/api/v1/admin/servers/add',{name:'Round2-muted-resource',alert_enabled:true});
  const renewal=await api('/api/v1/admin/servers/add',{name:'Round2-offline-renewal',alert_enabled:true,billing_cycle:'monthly',renewal_date:'2026-10-31',alert_rules:{billing:true}});
  const stats={mem_used_bytes:95*1024**2,mem_total_bytes:100*1024**2,disk_used_bytes:95*1024**3,disk_total_bytes:100*1024**3,cpu_cores:2,load1:3};
  const active=await addPeer(resource.token,{rx:0,tx:0,stats}),muted=await addPeer(quiet.token,{rx:0,tx:0,stats});
  const db=new DatabaseSync(dbPath),now=Math.floor(Date.now()/1000),target=(await api('/api/v1/admin/targets'))[0].id;
  for(let i=0;i<3;i++)db.prepare('INSERT INTO target_metrics(server_id,target_id,ts,ms) VALUES(?,?,?,999)').run(resource.id,target,now-i*60);db.close();
  await alertConfig({resource_rules:{memory:true,memory_percent:90,disk:true,disk_percent:90,load:true,load_per_core:1,loss:true,loss_percent:20,billing:true,billing_days:7}});
  for(const label of ['内存告警','磁盘告警','负载告警','探测失败率告警','续费告警'])await until(()=>events.some(e=>e.title.includes(label)),22000);
  assert.equal((await node(renewal.id)).status,'offline');assert.ok(!events.some(e=>e.title.includes('Round2-muted-resource')));
  const before=events.filter(e=>/Round2-resource|Round2-offline-renewal/.test(e.title)).length;await sleep(4000);assert.equal(events.filter(e=>/Round2-resource|Round2-offline-renewal/.test(e.title)).length,before);
  for(const id of [resource.id,quiet.id,renewal.id])assert.equal((await node(id)).alert_enabled,true);
  active.close();muted.close();await alertConfig({resource_rules:{memory:false,disk:false,load:false,loss:false,billing:false}});
 });
 await check('disabled SMTP with a configured hostname is never attempted',async()=>{
  const smtp=net.createServer(socket=>{measurements.smtpConnections=(measurements.smtpConnections||0)+1;socket.destroy()});await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
  try{await alertConfig({smtp_enabled:false,smtp_host:'127.0.0.1',smtp_port:smtp.address().port,telegram_enabled:false,webhook_enabled:false});const result=await api('/api/v1/admin/alerts/test',{});assert.equal(result.success,false);assert.equal(measurements.smtpConnections||0,0)}finally{smtp.close()}
  await alertConfig({webhook_enabled:true});
 });
 await check('offline calibration waits for a fresh baseline and counters survive resets',async()=>{
  first.close();await until(async()=>(await node(created.id)).status==='offline',8000);
  assert.equal((await api('/api/v1/admin/servers/calibrate',{id:created.id,used_gb:10})).success,true);
  assert.equal((await node(created.id)).traffic_used_gb,10);
  const counters={rx:3000000000,tx:600000000};first=await addPeer(created.token,counters);await until(async()=>(await node(created.id)).status==='online');assert.equal((await node(created.id)).traffic_used_gb,10);
  counters.tx+=1024**3;await until(async()=>(await node(created.id)).traffic_used_gb===11);
  counters.tx=1024;await sleep(700);assert.equal((await node(created.id)).traffic_used_gb,11+1024/1024**3);
 });
 await check('default target resets preserve selected IDs and deleting the last selection pauses explicitly',async()=>{
  const targets=await api('/api/v1/admin/targets'),id=targets[0].id;await configure(created.id,{monitor_mode:'selected',monitor_targets:String(id)});
  for(let i=0;i<2;i++){const reset=await api('/api/v1/admin/targets/reset_defaults',{});assert.equal(reset.success,true);assert.equal((await node(created.id)).monitor_targets,String(id));assert.equal((await node(created.id)).monitor_enabled,true)}
  const result=await api('/api/v1/admin/targets/delete',{id});assert.equal(result.paused_nodes,1);assert.equal((await node(created.id)).monitor_enabled,false);await api('/api/v1/admin/targets/reset_defaults',{});
 });
 first.close();await stop();
 // Four million rows approximate 30 days × 93 targets at one sample per minute.
 const conn=new DatabaseSync(dbPath),now=Math.floor(Date.now()/1000);console.log('Seeding isolated 4,017,600-row history fixture');
 conn.exec('PRAGMA synchronous=OFF; PRAGMA journal_mode=WAL;');
 conn.prepare(`WITH RECURSIVE ticks(n) AS(VALUES(0) UNION ALL SELECT n+1 FROM ticks WHERE n<43199)
 INSERT INTO target_metrics(server_id,target_id,ts,ms) SELECT ?,t.id,?-n*60,CASE WHEN n%19=0 THEN 999 ELSE 20+n%70 END FROM ticks CROSS JOIN monitor_targets t`).run(history.id,now);
 conn.prepare('INSERT INTO metrics(server_id,ts,latency_ct,latency_cu,latency_cm) VALUES(?,?,?,?,?)').run(history.id,now-10,20,999,0);
 conn.prepare('INSERT INTO metrics(server_id,ts,latency_ct,latency_cu,latency_cm) VALUES(?,?,?,?,?)').run(history.id,now-10,999,999,0);
 conn.prepare("UPDATE metrics SET latency_source='sh-zstatic-tcp80-v1' WHERE server_id=?").run(history.id);
 measurements.historyRows=conn.prepare('SELECT COUNT(*) n FROM target_metrics WHERE server_id=?').get(history.id).n;conn.close();await start();first=await addPeer(created.token);await until(async()=>(await node(created.id)).status==='online');
 await check('30-day concurrent anonymous history queries do not delay public reads or heartbeats',async()=>{
  const before=events.length,t0=Date.now(),latencies=[];let running=true;
  const monitor=(async()=>{while(running){const t=Date.now();await api('/api/v1/servers',null,true);latencies.push(Date.now()-t);await sleep(100)}})();
  const queries=Array.from({length:8},async()=>{const rows=await api(`/api/v1/target_metrics/${history.id}?hours=720&bucket=30`,null,true);assert.ok(rows.length>0);assert.ok(rows.every(s=>s.points.length<=481));return rows.length});
  try{await Promise.all(queries)}finally{running=false;await monitor}
  measurements.concurrentHistoryMs=Date.now()-t0;measurements.maximumPublicReadMs=Math.max(...latencies);
  assert.ok(measurements.maximumPublicReadMs<1500,JSON.stringify(measurements));assert.equal((await node(created.id)).status,'online');assert.equal(events.length,before);
 });
 await check('timeouts and unmeasured values never contribute to latency averages',async()=>{
  const rows=await api(`/api/v1/metrics/${history.id}?hours=1`,null,true),last=rows.at(-1);assert.equal(last.lat_ct,20);assert.equal(last.lat_ct_max,20);assert.equal(last.lat_cu,null);assert.equal(last.lat_cm,null);assert.equal(last.lat_ct_timeouts,1);assert.equal(last.lat_cu_timeouts,2);
 });
 await check('monthly traffic thresholds are emitted once per billing period',async()=>{
  await configure(created.id,{traffic_limit_gb:1,alert_traffic:true});await alertConfig({notify_traffic:true,traffic_threshold:90});await api('/api/v1/admin/servers/calibrate',{id:created.id,used_gb:2});
  await until(()=>events.some(e=>e.title.includes('流量告警')),8000);const count=events.filter(e=>e.title.includes('流量告警')).length;
  const db=new DatabaseSync(dbPath);db.exec("UPDATE alert_state SET last_notified=1 WHERE key LIKE '%:traffic:%'");db.close();await sleep(4000);assert.equal(events.filter(e=>e.title.includes('流量告警')).length,count);
 });
 await check('fresh Agent binary connects and reports system data',async()=>{
  const real=await api('/api/v1/admin/servers/add',{name:'Round2-native-agent'});
  agent=spawn(process.env.MONITER_TEST_AGENT||path.join(root,'target-review/debug/aegis-agent.exe'),['--server',origin.replace('http','ws')+'/ws/agent'],{cwd:fixture,env:{...process.env,AEGIS_AGENT_TOKEN:real.token},windowsHide:true,stdio:'ignore'});
  await until(async()=>{const n=(await api('/api/v1/servers',null,true)).find(n=>n.id===real.id);return n?.status==='online'&&n?.cpu_cores>0},20000);
  const db=new DatabaseSync(dbPath,{readOnly:true});const row=db.prepare('SELECT latency_source FROM metrics WHERE server_id=? ORDER BY ts DESC LIMIT 1').get(real.id);db.close();assert.equal(row?.latency_source,'sh-zstatic-tcp80-v1','Actual Agent report did not persist with its source marker');
 });
 console.log(JSON.stringify({passed:passed.length,measurements}));
}
main().catch(error=>{process.exitCode=1;console.error(error.stack)}).finally(async()=>{
 for(const peer of peers)peer.close();if(agent&&agent.exitCode===null){const done=new Promise(r=>agent.once('exit',r));agent.kill();await done}await stop();if(receiver)await new Promise(r=>receiver.close(r));
 fs.writeFileSync(path.join(output,'round2-regression-result.json'),JSON.stringify({date:new Date().toISOString(),passed,measurements,success:!process.exitCode},null,2));
 if(path.dirname(fixture)===output&&path.basename(fixture).startsWith('round2-fixture-'))fs.rmSync(fixture,{recursive:true,force:true});
});
