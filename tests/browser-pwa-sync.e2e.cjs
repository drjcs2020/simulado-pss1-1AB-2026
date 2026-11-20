'use strict';
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=process.cwd();
const app='https://script.google.com/macros/s/pss1-test/exec';
const portPromise=new Promise(resolve=>{
 const server=http.createServer((req,res)=>{
  const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  let file=path.resolve(root,'.'+(requestPath==='/'?'/index.html':requestPath));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(file,(err,data)=>{
   if(err){res.writeHead(404).end();return}
   const mime=file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':
    file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'application/javascript';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(data);
  });
 });
 server.listen(0,'127.0.0.1',()=>resolve({server,url:'http://127.0.0.1:'+server.address().port+'/'}));
});
function newSheet(){return {'1A':[{'Nº':1,Tipo:'A',Status:'Pendente'}],'1B':[]}}
function makeScores(marks){
 const keys=[11,5,14,11,13,7,14,11,13,7];
 return marks.map((m,i)=>{
  if(m===0||(m&~keys[i])!==0)return 0;
  let total=0,count=0;
  for(let b=0;b<4;b++){if((keys[i]>>b)&1)total++;if((m>>b)&1)count++}
  return Math.round(count/total*100)/100;
 });
}
async function createScenario(browser,url,config={}){
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const store={remote:newSheet(),online:false,postAttempts:0,dropPostResponse:false,...config};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(url=>{
  localStorage.setItem('pss1_2026_gas_url',url);
 },app);
 await page.route('https://script.google.com/macros/s/pss1-test/exec**',async route=>{
  if(!store.online){await route.abort('internetdisconnected');return}
  const req=route.request();
  if(req.method()==='GET'){
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
    body:JSON.stringify({status:'ok',version:4,turmas:store.remote})});
   return;
  }
  if(req.method()==='POST'){
   store.postAttempts++;
   const payload=JSON.parse(req.postData()||'{}');
   assert.equal(payload.records?.length,1);
   const rec=payload.records[0];
   const row=store.remote[rec.turma].find(r=>Number(r['Nº'])===Number(rec.num));
   assert.ok(row,'student missing on mock server');
   const points=makeScores(rec.marks);
   assert.deepEqual(points,rec.scores,'server and browser must agree on partial scoring');
   row.Status='Corrigida';row.Atualizado_Em=new Date().toISOString();
   for(let i=0;i<10;i++)row['Q'+String(i+1).padStart(2,'0')]=points[i];
   if(store.dropPostResponse){
    store.dropPostResponse=false;await route.abort('internetdisconnected');return;
   }
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
    body:JSON.stringify({status:'ok',updated:1,version:4,
      acknowledged:[{turma:rec.turma,num:rec.num,total:rec.total}]})});
   return;
  }
  await route.abort('blockedbyclient');
 });
 await page.goto(url,{waitUntil:'load'});
 await page.locator('#studentMeta').waitFor();
 return {context,page,store,errors};
}
async function pending(page,expected){
 await page.waitForFunction(value=>{
  const el=document.querySelector('#pendingAlert');
  return !!el&&(!el.hidden)===value;
 },expected,{timeout:15000});
}
async function submitExample(page){
 await page.locator('.question').first().locator('button.choice',{hasText:'01'}).click();
 await page.locator('#save').click();
 await pending(page,true);
 assert.match(await page.locator('#pendingInfo').innerText(),/lançamento\(s\) guardado\(s\)/);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('pss1_2026_queue')));
 assert.equal(state.length,1,'note is stored before network communication');
 assert.ok(state[0].scores[0]>0,'partial or exact scoring is preserved');
}
(async()=>{
 const {server,url}=await portPromise;
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const installed=await createScenario(browser,url,{online:false});
  const {page,context,store}=installed;
  const manifestURL=await page.locator('link[rel=manifest]').getAttribute('href');
  assert.equal(manifestURL,'./manifest.webmanifest');
  const manifestResponse=await page.request.get(new URL(manifestURL,url).toString());
  assert.equal(manifestResponse.status(),200);
  const manifest=await manifestResponse.json();
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'./?source=pwa');
  assert.equal(manifest.scope,'./');
  for(const size of [192,512]){
   const icon=manifest.icons.find(i=>i.sizes===size+'x'+size);
   assert.ok(icon,'PWA icon '+size+' missing');
   const response=await page.request.get(new URL(icon.src,url).toString());
   assert.equal(response.status(),200);
   const bytes=await response.body();
   assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a','PNG signature');
   assert.equal(bytes.readUInt32BE(16),size,'PNG width');
   assert.equal(bytes.readUInt32BE(20),size,'PNG height');
  }
  const scanner=await page.request.get(url+'scanner.html');
  assert.match(await scanner.text(),/rel="manifest"/);
  console.log('PASS: PWA manifest links, standalone mode, PNG 192/512 and scanner entry point');

  await submitExample(page);
  assert.equal(store.postAttempts,0,'offline notes must not post');
  await page.reload({waitUntil:'load'});
  await pending(page,true);
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('pss1_2026_queue')))).length,1);
  store.online=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await pending(page,false);
  assert.equal(store.postAttempts,1,'exactly one post after internet returns');
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('pss1_2026_queue')))).length,0);
  assert.match(await page.locator('#studentMeta').innerText(),/Corrigida no Google Sheets/);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1700);
  assert.equal(store.postAttempts,1,'subsequent reconnect must not duplicate');
  assert.deepEqual(installed.errors,[]);
  console.log('PASS: interrupted connection, persisted note, automatic resend and Google Sheets confirmation');
  // A correção de teste pode ser excluída na planilha por uma implantação Apps Script:
  // o aplicativo deve limpar cache e quadradinhos após "Atualizar planilha".
  const resetRow=store.remote['1A'][0];resetRow.Status='Pendente';
  for(let q=1;q<=10;q++)delete resetRow['Q'+String(q).padStart(2,'0')];
  await page.locator('#tabGrades').click();
  await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.querySelector('#studentMeta')?.textContent?.includes('Pendente'),null,{timeout:12000});
  await page.locator('#tabCorrect').click();
  assert.match(await page.locator('.question').first().locator('.qname').innerText(),/Soma 00/);
  assert.equal((await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('pss1_2026_db'))['1A']).length)),0);
  console.log('PASS: reset remoto marca aluno Pendente e limpa as dez somatórias na interface');
  await context.close();

  const lost=await createScenario(browser,url,{online:true,dropPostResponse:true});
  await submitExample(lost.page);
  await lost.page.waitForFunction(()=>document.querySelector('#sheetsMessage')?.textContent?.includes('Sem confirmação'),null,{timeout:10000});
  assert.equal(lost.store.postAttempts,1,'first POST must be attempted');
  assert.equal(lost.store.remote['1A'][0].Status,'Corrigida','server committed despite lost response');
  assert.equal((await lost.page.evaluate(()=>JSON.parse(localStorage.getItem('pss1_2026_queue')))).length,1);
  await lost.page.locator('#retryPending').click();
  await pending(lost.page,false);
  assert.equal(lost.store.postAttempts,1,'GET reconciliation prevents duplicate POST after lost reply');
  assert.match(await lost.page.locator('#studentMeta').innerText(),/Corrigida no Google Sheets/);
  assert.deepEqual(lost.errors,[]);
  console.log('PASS: lost POST response recognized by GET, no duplicate submission');
  await lost.context.close();
 }finally{
  if(browser)await browser.close();
  server.close();
 }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
