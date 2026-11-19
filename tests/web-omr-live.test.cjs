const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('omr-live-decimal-worker.js','utf8');
const self={last:null,postMessage(value){this.last=value}};
vm.runInNewContext(source,{self,Uint8Array,Uint32Array,Int32Array,Math,Error});
const answers=[5,13,8,0,15,18,4,9,2,5];
function syntheticCard(contrast=false){
 const w=640,h=432;
 const pixels=new Uint8Array(w*h*4);
 for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=contrast?208:255;pixels[i+3]=255}
 const dot=(x,y)=>{
  x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=w||y>=h)return;
  const i=4*(y*w+x);pixels[i]=pixels[i+1]=pixels[i+2]=contrast?58:0;
 };
 const line=(x0,y0,x1,y1,thickness=1)=>{
  const count=Math.ceil(Math.max(Math.abs(x1-x0),Math.abs(y1-y0)));
  for(let t=0;t<=count;t++)for(let dx=0;dx<thickness;dx++){
   const x=x0+(x1-x0)*t/count,y=y0+(y1-y0)*t/count;dot(x+dx,y);
  }
 };
 const square=(x,y,size=25)=>{
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
   const border=Math.min(i,j,size-1-i,size-1-j);
   if(border<=2||(i>=9&&i<=15&&j>=9&&j<=15))dot(x+i,y+j);
  }
 };
 for(const [x,y] of [[5,8],[610,8],[5,405],[610,405]])square(x,y);
 const point=(u,v)=>({x:17+605*u,y:20+397*v});
 for(const y of [.428,.477,.939]){const p=point(.012,y),r=point(.986,y);line(p.x,p.y,r.x,r.y)}
 for(let q=0;q<10;q++){
  const value=answers[q];
  for(let c=0;c<2;c++)for(let d=0;d<(c===0?2:10);d++){
   const p=point((c===0?.0377:.072)+q*.0993,.5035+d*.0446);
   const selected=c===0?d===Math.floor(value/10):d===value%10;
   for(let yy=-6;yy<=6;yy++)for(let xx=-6;xx<=6;xx++){
    const border=Math.max(Math.abs(xx),Math.abs(yy))>=5;
    const glyph=!selected&&Math.abs(xx)<=1&&(Math.abs(yy)===2||Math.abs(yy)===3);
    if(border||selected&&Math.abs(xx)<=4&&Math.abs(yy)<=4||glyph)dot(p.x+xx,p.y+yy);
   }
  }
 }
 return {width:w,height:h,pixels};
}
function rotateCard(card,degree){
 const w=degree%180===0?card.width:card.height;
 const h=degree%180===0?card.height:card.width;
 const data=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let sx=x,sy=y;
  if(degree===180){sx=card.width-1-x;sy=card.height-1-y}
  if(degree===90){sx=y;sy=card.height-1-x}
  if(degree===270){sx=card.width-1-y;sy=x}
  const si=(sy*card.width+sx)*4,di=(y*w+x)*4;
  for(let k=0;k<4;k++)data[di+k]=card.pixels[si+k];
 }
 return {width:w,height:h,pixels:data};
}
function scan(name,image,expected=answers){
 self.onmessage({data:{action:'analyze',id:8,width:image.width,height:image.height,pixels:image.pixels.buffer}});
 assert.equal(self.last.status,'ok',name+': '+self.last.message);
 const result=self.last.result;
 const raw=result.results.map(x=>x.rawValue);
 assert.equal(result.markersFound,4,name+' marker count');
 assert.equal(JSON.stringify(raw),JSON.stringify(expected),name+': '+JSON.stringify(raw));
 assert.equal(result.boxes.length,10,name+' boxes');
 assert.ok(result.results.every(r=>r.columns.length===2),name+' decimal columns');
 assert.equal(result.results[5].valid,false,name+' invalid over 15');
 assert.equal(result.results[5].value,null,name+' never grade 18');
 console.log('PASS',name,raw.join(','),'invalid Q06=',result.results[5].error);
}
scan('Cartão de dezena/unidade em paisagem',syntheticCard());
scan('Cartão de menor contraste',syntheticCard(true));
scan('Cartão girado 90 graus',rotateCard(syntheticCard(),90));
scan('Cartão girado 180 graus',rotateCard(syntheticCard(),180));
scan('Cartão girado 270 graus',rotateCard(syntheticCard(),270));
const missing=syntheticCard();
for(let y=0;y<75;y++)for(let x=0;x<80;x++){
 const i=(y*missing.width+x)*4;missing.pixels[i]=missing.pixels[i+1]=missing.pixels[i+2]=255;
}
self.onmessage({data:{action:'analyze',id:9,width:missing.width,height:missing.height,pixels:missing.pixels.buffer}});
assert.ok(self.last.result.error,'four markers required; never invent answers');
console.log('PASS marcador ausente não cria notas');
