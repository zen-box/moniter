const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
(async()=>{
 const destination=path.join(root,'_backup','pre-round2-'+new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(destination,{recursive:true});
 const source=new DatabaseSync(path.join(root,'data/probe.db'),{readOnly:true});
 await backup(source,path.join(destination,'probe.db'));source.close();
 const snapshot=new DatabaseSync(path.join(destination,'probe.db'),{readOnly:true});
 if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Backup quick_check failed');
 const metadata={siteName:snapshot.prepare("SELECT value FROM settings WHERE key='site_name'").get()?.value,
   servers:snapshot.prepare('SELECT COUNT(*) n FROM servers').get().n,targets:snapshot.prepare('SELECT COUNT(*) n FROM monitor_targets').get().n,
   sessions:snapshot.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n};snapshot.close();
 fs.copyFileSync(path.join(root,'target-review/release/aegis-server.exe'),path.join(destination,'aegis-server.exe'));
 const agent=process.env.MONITER_TEST_AGENT||path.join(root,'binaries/aegis-agent-windows-amd64');
 fs.copyFileSync(agent,path.join(destination,'aegis-agent.exe'));
 for(const dir of ['web/dist','web/themes','binaries']){if(fs.existsSync(path.join(root,dir)))fs.cpSync(path.join(root,dir),path.join(destination,dir),{recursive:true});}
 fs.writeFileSync(path.join(destination,'metadata.json'),JSON.stringify({...metadata,date:new Date().toISOString(),note:'Static files reflect the working tree at backup time. The earlier pre-production backup also retains the previous complete UI.'},null,2));
 fs.writeFileSync(path.join(root,'.ui-review/round2-backup.json'),JSON.stringify({destination,...metadata},null,2));
 console.log(JSON.stringify({destination,...metadata,quickCheck:'ok'}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
