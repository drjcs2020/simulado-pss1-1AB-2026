const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('omr-live-decimal-worker.js','utf8');
const self={last:null,postMessage(r){this.last=r}};
vm.runInNewContext(source,{self,Uint8Array,Uint32Array,Int32Array,Float64Array,Map,Math});
const W=640,H=480,answers=[5,13,8,0,15,18,4,9,2,5];
const corners={tl:{x:43,y:34},tr:{x:592,y:42},bl:{x:38,y:357},br:{x:571,y:443}};
function project(u,v){
 const {tl,tr,bl,br}=corners;
 const dx1=tr.x-br.x,dy1=tr.y-br.y,dx2=bl.x-br.x,dy2=bl.y-br.y;
 const dx3=tl.x-tr.x+br.x-bl.x,dy3=tl.y-tr.y+br.y-bl.y;
 const det=dx1*dy2-dx2*dy1,g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
 const a=tr.x-tl.x+g*tr.x,b=bl.x-tl.x+h*bl.x;
 const d=tr.y-tl.y+g*tr.y,e=bl.y-tl.y+h*bl.y;
 const scale=1+g*u+h*v;
 return {x:(a*u+b*v+tl.x)/scale,y:(d*u+e*v+tl.y)/scale};
}
function create(contrast=false,qr=false){
 const pix=new Uint8Array(W*H*4);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const gradient=contrast?170:232;
  const bg=gradient+Math.round((x/W)*14-(y/H)*23);
  const k=4*(y*W+x);
  pix[k]=pix[k+1]=pix[k+2]=Math.max(5,Math.min(255,bg));pix[k+3]=255;
 }
 const set=(x,y,value,opacity=1)=>{
  x=Math.round(x);y=Math.round(y);
  if(x<0||y<0||x>=W||y>=H)return;
  const k=4*(y*W+x);
  for(let i=0;i<3;i++)pix[k+i]=Math.round(pix[k+i]*(1-opacity)+value*opacity);
 };
 const line=(a,b,opacity=.75)=>{
  const n=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y)*1.4);
  for(let i=0;i<=n;i++){
   const v=i/n;
   set(a.x*(1-v)+b.x*v,a.y*(1-v)+b.y*v,contrast?76:35,opacity);
  }
 };
 const finder=(p,size,opacity=1)=>{
  const s=Math.floor(size/2);
  for(let y=-s;y<=s;y++)for(let x=-s;x<=s;x++){
   const max=Math.max(Math.abs(x),Math.abs(y));
   const black=max>=s-2||max<=Math.max(2,s*.33);
   if(black)set(p.x+x,p.y+y,contrast?100:24,opacity);
   else set(p.x+x,p.y+y,contrast?195:245,.95);
  }
 };
 finder(corners.tl,23);
 finder(corners.tr,23,contrast?.62:.87); // faint right corner like screenshot
 finder(corners.bl,23);
 finder(corners.br,23,contrast?.70:.88);
 if(qr){
  // One QR finder can look just like a page marker; must never become a corner.
  finder(project(.78,.17),23);
  finder(project(.86,.17),23);
  finder(project(.78,.29),23);
 }
 for(const v of [.428,.477,.939])line(project(.012,v),project(.985,v),.95);
 for(let q=0;q<10;q++){
  for(const uu of [.008+q*.0993,.098+(q*.0993)]){
   line(project(uu,.429),project(uu,.939),.45);
  }
  const value=answers[q];
  for(let c=0;c<2;c++)for(let d=0;d<(c===0?2:10);d++){
   const p=project((c===0?.0377:.072)+q*.0993,.5035+d*.0446);
   const selected=c===0?d===Math.floor(value/10):d===value%10;
   for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
    const border=Math.max(Math.abs(dx),Math.abs(dy))===4;
    if(border||(selected&&Math.max(Math.abs(dx),Math.abs(dy))<=3))
     set(p.x+dx,p.y+dy,contrast?70:17,.92);
   }
  }
 }
 return {width:W,height:H,pixels:pix.buffer};
}
function check(label,contrast,qr){
 const frame=create(contrast,qr);
 const start=performance.now();
 self.onmessage({data:{action:'analyze',id:1,...frame}});
 assert.equal(self.last.status,'ok',label+': '+self.last.message);
 const result=self.last.result;
 const got=result.results.map(r=>r.rawValue);
 assert.equal(result.markersFound,4,label+' must identify four REAL corners');
 assert.ok(result.orientationConfidence>.54,label+' must align page grid, not QR');
 assert.equal(JSON.stringify(got),JSON.stringify(answers),
   label+' values '+JSON.stringify(got)+' corners '+JSON.stringify(result.corners));
 assert.equal(result.results[5].valid,false,label+' rejects 18');
 const actual=result.corners;
 for(const key of ['tl','tr','bl','br']){
  const distance=Math.hypot(actual[key].x-corners[key].x,actual[key].y-corners[key].y);
  assert.ok(distance<15,label+' '+key+' drift '+distance);
 }
 console.log('PASS',label,'in',Math.round(performance.now()-start)+'ms',got.join(','));
}
check('perspective tilt',false,false);
check('uneven lighting and faint upper-right corner',true,false);
check('faint corners plus three misleading QR finders',true,true);
