const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const packages=fs.readFileSync(path.join(root,'Cargo.lock'),'utf8').split('[[package]]').slice(1).filter(block=>/source = "registry\+https:\/\/github.com\/rust-lang\/crates.io-index"/.test(block)).map(block=>({name:block.match(/name = "([^"]+)"/)[1],version:block.match(/version = "([^"]+)"/)[1]}));
(async()=>{
 const findings=[];
 for(let start=0;start<packages.length;start+=100){
  const batch=packages.slice(start,start+100);
  const response=await fetch('https://api.osv.dev/v1/querybatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queries:batch.map(p=>({package:{ecosystem:'crates.io',name:p.name},version:p.version}))}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('OSV status '+response.status);
  const data=await response.json();if(data.results?.length!==batch.length)throw Error('Incomplete OSV result');
  data.results.forEach((item,index)=>{if(item.vulns?.length)findings.push({...batch[index],vulns:item.vulns})});
 }
 const result={date:new Date().toISOString(),source:'OSV API / crates.io',checked:packages.length,findings};
 fs.writeFileSync(path.join(root,'.ui-review/cargo-osv-round2-2026-11-01.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(findings.length)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1});
