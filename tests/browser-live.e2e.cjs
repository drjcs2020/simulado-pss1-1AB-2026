const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 let file=path.join(root,decodeURIComponent(url.pathname));
 if(url.pathname==='/')file=path.join(root,'index.html');
 if(!file.startsWith(root)){res.writeHead(403).end();return}
 fs.readFile(file,(err,data)=>{
  if(err){res.writeHead(404).end();return}
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':'text/plain'});
  res.end(data);
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:850},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{
   const original=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
   const create=()=>{
    const canvas=document.createElement('canvas'),w=640,h=432;canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    const ink=(x,y)=>{
     x=Math.round(x);y=Math.round(y);if(x<0||x>=w||y<0||y>=h)return;
     ctx.fillRect(x,y,1,1);
    };
    const line=(x0,y0,x1,y1)=>{
     const steps=Math.ceil(Math.max(Math.abs(x1-x0),Math.abs(y1-y0)));
     for(let i=0;i<=steps;i++)ink(x0+(x1-x0)*i/steps,y0+(y1-y0)*i/steps);
    };
    const values=[5,13,8,0,15,18,4,9,2,5];
    const square=(x,y)=>{
     for(let j=0;j<25;j++)for(let i=0;i<25;i++)
      if(Math.min(i,j,24-i,24-j)<=2||(i>=9&&i<=15&&j>=9&&j<=15))ink(x+i,y+j);
    };
    window.__pssBlankFrame=false;
    function draw(){
     ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
     if(window.__pssBlankFrame)return;
     ctx.fillStyle='#000';
     for(const [x,y] of [[5,8],[610,8],[5,405],[610,405]])square(x,y);
     const point=(u,v)=>({x:17+605*u,y:20+397*v});
     for(const v of [.428,.477,.939]){const a=point(.012,v),b=point(.986,v);line(a.x,a.y,b.x,b.y)}
     for(let q=0;q<10;q++)for(let c=0;c<2;c++)for(let d=0;d<(c===0?2:10);d++){
      const value=values[q],p=point((c===0?.0377:.072)+q*.0993,.5035+d*.0446);
      const filled=c===0?d===Math.floor(value/10):d===value%10;
      for(let yy=-6;yy<=6;yy++)for(let xx=-6;xx<=6;xx++){
       if(Math.max(Math.abs(xx),Math.abs(yy))>=5||(filled&&Math.abs(xx)<=4&&Math.abs(yy)<=4))ink(p.x+xx,p.y+yy);
      }
     }
    }
    draw();setInterval(draw,120);
    return canvas.captureStream(12);
   };
   if(!navigator.mediaDevices)Object.defineProperty(navigator,'mediaDevices',{value:{},configurable:true});
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>create(),configurable:true});
  });
  await page.goto('http://127.0.0.1:'+port+'/scanner.html?turma=1A&num=1&tipo=A',{waitUntil:'load'});
  try{
    await page.waitForFunction(()=>document.querySelector('#progress')?.textContent?.includes('9/10 respostas'),null,{timeout:22000});
  }catch(error){
    const state=await page.evaluate(()=>({
      progress:document.querySelector('#progress')?.textContent,
      stream:!!window.state?.stream,
      dims:[document.querySelector('#video')?.videoWidth,document.querySelector('#video')?.videoHeight],
      overlay:document.querySelector('#overlay')?.width,
      worker:typeof Worker,
    }));
    console.error('CAMERA DIAGNOSTIC',JSON.stringify(state),'BROWSER ERRORS',pageErrors);
    throw error;
  }
  const before=await page.locator('#progress').innerText();
  assert.match(before,/Q06.*18.*inválida/);
  const pixelCount=await page.evaluate(()=>{
   const ctx=document.getElementById('overlay').getContext('2d');
   const a=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height).data;
   let n=0;for(let i=0;i<a.length;i+=4)if(a[i+3]>0&&a[i+1]>a[i]&&a[i+1]>a[i+2])n++;
   return n;
  });
  assert.ok(pixelCount>100,'green optical highlights missing: '+pixelCount);
  const yellowPixelCount=await page.evaluate(()=>{
   const c=document.querySelector('#overlay'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let n=0;
   for(let i=0;i<d.length;i+=4)if(d[i]>180&&d[i+1]>110&&d[i+2]<140&&d[i+3]>150)n++;
   return n;
  });
  assert.ok(yellowPixelCount>150,'missing yellow corner alignment guides: '+yellowPixelCount);
  const dimensions=await page.evaluate(()=>{
   const guide=guideRect();
   return {width:guide.width,height:guide.height,ratio:guide.width/guide.height};
  });
  assert.ok(dimensions.width>200&&Math.abs(dimensions.ratio-1.52)<.01,
    'Guide must match physical card aspect ratio');
  console.log('PASS câmera de vídeo: 9/10, Q06=18 rejeitada, '+pixelCount+' pixels verdes e '+yellowPixelCount+' de guia amarelo');
  fs.mkdirSync('test-output',{recursive:true});
  await page.screenshot({path:'test-output/live.png'});
  // Mesmo sem cartão visível, as quatro referências devem permanecer na câmera.
  await page.evaluate(()=>{window.__pssBlankFrame=true});
  await page.waitForFunction(()=>document.querySelector('#progress')?.textContent?.includes('Aponte para o cartão completo'),null,{timeout:15000});
  const yellowOnBlank=await page.evaluate(()=>{
   const c=document.querySelector('#overlay'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>180&&d[i+1]>110&&d[i+2]<140&&d[i+3]>150)n++;
   return n;
  });
  assert.ok(yellowOnBlank>150,'Yellow guide disappeared without a card');
  console.log('PASS guia amarelo permanece no vídeo sem cartão, sem exigir alinhamento milimétrico');
  // O retorno da marcação não deve ficar vazio quando o cartão reaparece.
  await page.evaluate(()=>{window.__pssBlankFrame=false});
  await page.waitForFunction(()=>document.querySelector('#progress')?.textContent?.includes('9/10 respostas'),null,{timeout:15000});
  await page.locator('#reviewLive').click();
  assert.equal(await page.locator('#reviewPanel').isVisible(),true,'Conferir não abriu tela correta');
  assert.equal(await page.locator('#camera').isVisible(),false,'câmera não fechou na conferência');
  assert.equal(await page.locator('.question').count(),10);
  const sixth=page.locator('.question').nth(5);
  assert.equal(await sixth.locator('.sum').innerText(),'—');
  for(const bit of ['01','02','04','08'])await sixth.locator('button.bit',{hasText:bit}).click();
  assert.equal(await sixth.locator('.sum').innerText(),'15');
  assert.equal(await page.locator('#send').isEnabled(),true);
  await page.screenshot({path:'test-output/review.png'});
  await page.locator('#send').click();
  await page.waitForURL(/index.html/,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#message')?.textContent?.includes('Respostas importadas'),null,{timeout:12000});
  const chosen=await page.locator('#studentMeta').innerText();
  assert.ok(chosen.includes('ALESSANDRO'), 'aluno QR perdido: '+chosen);
  console.log('PASS: conferência, ajuste por toque e retorno ao aluno correto no aplicativo');
  assert.deepEqual(pageErrors,[],'Erros de JavaScript: '+pageErrors.join(';'));
 }finally{
  if(browser)await browser.close();
  server.close();
 }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
