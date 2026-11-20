"use strict";
// Reconhecimento AO VIVO do cartão decimal realmente impresso (10 colunas).
// Identifica os quatro marcadores de canto e usa suas posições para alinhar o quadro.
// Cada coluna tem uma casa da dezena (0/1) e outra de unidade (0..9).
const MARKER_ROIS=[
 {name:'tl',x0:0,x1:.32,y0:0,y1:.33},
 {name:'tr',x0:.68,x1:1,y0:0,y1:.33},
 {name:'bl',x0:0,x1:.32,y0:.67,y1:1},
 {name:'br',x0:.68,x1:1,y0:.67,y1:1}
];
function binaryFromRGBA(input){
 const w=input.width,h=input.height,rgba=new Uint8Array(input.pixels);
 if(w<240||h<180||rgba.length!==w*h*4)throw Error('Quadro da câmera incompleto');
 const gray=new Uint8Array(w*h),hist=new Uint32Array(256);
 let total=0;
 for(let i=0,j=0;i<rgba.length;i+=4,j++){
  const value=Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]);
  gray[j]=value;hist[value]++;total+=value;
 }
 let threshold=127,max=-1,count=0,sum=0;
 for(let t=0;t<256;t++){
  count+=hist[t];sum+=t*hist[t];
  if(!count||count===gray.length)continue;
  const a=sum/count,b=(total-sum)/(gray.length-count);
  const between=count*(gray.length-count)*(a-b)*(a-b);
  if(between>max){max=between;threshold=t}
 }
 const mask=new Uint8Array(w*h);
 for(let i=0;i<gray.length;i++)mask[i]=gray[i]<=threshold?1:0;
 // Keep grayscale: weak markers on blue/lit screens disappear in a global threshold.
 mask.gray=gray;
 return mask;
}

function findNestedFinderCandidates(gray,w,h){
 // Correlation against the *actual* concentric 7x7 target:
 // dark perimeter, light ring, dark middle. Independent of overall brightness.
 // Uses integral images, so evaluating each size/position takes constant time.
 const stride=w+1,length=stride*(h+1);
 const sums=new Float64Array(length),squares=new Float64Array(length);
 for(let y=0;y<h;y++){
  let sum=0,sum2=0;
  const out=(y+1)*stride,prev=y*stride;
  for(let x=0;x<w;x++){
   const v=gray[y*w+x];
   sum+=v;sum2+=v*v;
   sums[out+x+1]=sums[prev+x+1]+sum;
   squares[out+x+1]=squares[prev+x+1]+sum2;
  }
 }
 const area=(table,x0,y0,x1,y1)=>{
  return table[y1*stride+x1]-table[y0*stride+x1]-table[y1*stride+x0]+table[y0*stride+x0];
 };
 const result=[];
 const sizes=[8,10,12,14,16,18,20,22,23,24,25,26,27,28,30,34,38,44];
 for(const size of sizes){
  if(size>Math.min(w,h)*.18)break;
  const ring=Math.max(1,Math.round(size/7));
  const core=Math.max(ring+1,Math.round(size*.34));
  const middle=size-2*ring,inner=size-2*core;
  if(inner<2)continue;
  const n=size*size,whiteCount=middle*middle-inner*inner;
  const variancePattern=whiteCount-whiteCount*whiteCount/n;
  const buckets=new Map();
  // Dense enough for 8-pixel markers, but leaves the camera/UI responsive.
  const step=size<=28?2:3;
  for(let y=0;y+size<h;y+=step)for(let x=0;x+size<w;x+=step){
   const outer=area(sums,x,y,x+size,y+size);
   const inside=area(sums,x+ring,y+ring,x+size-ring,y+size-ring);
   const center=area(sums,x+core,y+core,x+size-core,y+size-core);
   const white=inside-center;
   const black=(outer-white)/(n-whiteCount);
   const light=white/whiteCount;
   const contrast=light-black;
   if(contrast<11)continue;
   const localVar=area(squares,x,y,x+size,y+size)-outer*outer/n;
   if(localVar<25)continue;
   const corr=(white-outer*whiteCount/n)/Math.sqrt(localVar*variancePattern);
   if(corr<.69)continue;
   const cx=x+size/2,cy=y+size/2;
   const key=Math.floor(cx/Math.max(11,size*.75))+','+Math.floor(cy/Math.max(11,size*.75));
   const quality=1+corr*.47+Math.min(.12,contrast/380);
   const found={x:cx,y:cy,size,quality,correlation:corr,contrast};
   const prior=buckets.get(key);
   if(!prior||prior.correlation<corr)buckets.set(key,found);
  }
  result.push(...buckets.values());
 }
 return result;
}
function detectCorners(mask,w,h){
 // Procura padrões quadrados por TODA a imagem, não apenas nas bordas do vídeo.
 // Assim funciona quando a folha ainda está pequena e centralizada.
 const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);
 const minSize=Math.max(6,Math.floor(Math.min(w,h)*.012));
 const maxSize=Math.floor(Math.min(w,h)*.18);
 const candidates=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const pos=y*w+x;
  if(visited[pos]||!mask[pos])continue;
  let head=0,tail=1,count=0,minX=x,maxX=x,minY=y,maxY=y;
  visited[pos]=1;queue[0]=pos;
  while(head<tail){
   const index=queue[head++],px=index%w,py=(index/w)|0;
   count++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);
   minY=Math.min(minY,py);maxY=Math.max(maxY,py);
   const neighbors=[px>0?index-1:-1,px<w-1?index+1:-1,
                    py>0?index-w:-1,py<h-1?index+w:-1];
   for(let k=0;k<4;k++){
    const n=neighbors[k];
    if(n<0||visited[n]||!mask[n])continue;
    visited[n]=1;queue[tail++]=n;
   }
  }
  const bw=maxX-minX+1,bh=maxY-minY+1,aspect=bw/bh;
  if(bw<minSize||bh<minSize||bw>maxSize||bh>maxSize||aspect<.73||aspect>1.33)continue;
  const fill=count/(bw*bh);
  if(fill<.23||fill>.88)continue;
  // Moldura dos marcadores: bordas escuras, centro com espaço branco.
  let perimeter=0,perimeterTotal=0,center=0,centerTotal=0;
  const inset=Math.min(2,Math.max(0,Math.floor(Math.min(bw,bh)*.075)));
  for(let k=0;k<=12;k++){
   const xx=minX+Math.round((bw-1)*k/12),yy=minY+Math.round((bh-1)*k/12);
   perimeter+=mask[(minY+inset)*w+xx]+mask[(maxY-inset)*w+xx];
   perimeter+=mask[yy*w+minX+inset]+mask[yy*w+maxX-inset];
   perimeterTotal+=4;
  }
  for(let dy=.30;dy<=.70;dy+=.20)for(let dx=.30;dx<=.70;dx+=.20){
   center+=mask[(minY+Math.round((bh-1)*dy))*w+minX+Math.round((bw-1)*dx)];
   centerTotal++;
  }
  const edgeRate=perimeter/perimeterTotal,centerRate=center/centerTotal;
  if(edgeRate<.62||centerRate>.80)continue;
  const size=(bw+bh)/2,cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const quality=edgeRate+(1-centerRate)*.3-Math.abs(aspect-1)*.4;
  candidates.push({x:cx,y:cy,size,quality});
 }
 // Include real finder patterns even if global Otsu discarded a faint corner.
 candidates.push(...findNestedFinderCandidates(mask.gray,w,h));
 // Deduplicate markers found at neighboring template sizes.
 candidates.sort((a,b)=>(b.correlation||0)-(a.correlation||0)||b.quality-a.quality);
 const unique=[];
 for(const candidate of candidates){
  if(unique.some(c=>Math.hypot(c.x-candidate.x,c.y-candidate.y)<Math.max(5,Math.min(c.size,candidate.size)*.35)))continue;
  unique.push(candidate);
 }
 // Do not truncate by pixel size: QR finder patterns can be larger.
 const possible=unique.slice(0,100);
 let best=null,bestScore=-Infinity;
 function nearest(x,y,size,excludeA,excludeB){
  let winner=null,smallest=Infinity;
  for(let i=0;i<possible.length;i++){
   if(i===excludeA||i===excludeB)continue;
   const p=possible[i];
   if(p.size<size*.55||p.size>size*1.7)continue;
   const distance=Math.hypot(p.x-x,p.y-y);
   if(distance<smallest){winner={...p,id:i,distance};smallest=distance}
  }
  return winner;
 }
 for(let i=0;i<possible.length;i++)for(let j=0;j<possible.length;j++){
  if(i===j)continue;
  const tl=possible[i],br=possible[j];
  const dx=br.x-tl.x,dy=br.y-tl.y;
  if(dx<w*.27||dy<h*.25)continue;
  const size=(tl.size+br.size)/2;
  if(tl.size<size*.65||br.size<size*.65)continue;
  const tr=nearest(br.x,tl.y,size,i,j);
  const bl=nearest(tl.x,br.y,size,i,j);
  if(!tr||!bl||tr.id===bl.id)continue;
  // The four corner fiducials form one page. A finder *inside the QR code*
  // can look identical, but cannot satisfy the expected page geometry.
  const tolerance=Math.max(dx,dy)*.195;
  if(tr.distance>tolerance||bl.distance>tolerance)continue;
  const topWidth=Math.hypot(tr.x-tl.x,tr.y-tl.y);
  const bottomWidth=Math.hypot(br.x-bl.x,br.y-bl.y);
  const leftHeight=Math.hypot(bl.x-tl.x,bl.y-tl.y);
  const rightHeight=Math.hypot(br.x-tr.x,br.y-tr.y);
  if(Math.max(topWidth,bottomWidth)/Math.min(topWidth,bottomWidth)>1.38)continue;
  if(Math.max(leftHeight,rightHeight)/Math.min(leftHeight,rightHeight)>1.42)continue;
  const ratio=(topWidth+bottomWidth)/(leftHeight+rightHeight);
  if(ratio<.50||ratio>2.6)continue;
  const ratios=[tl.size,tr.size,bl.size,br.size];
  if(Math.max(...ratios)/Math.min(...ratios)>1.7)continue;
  const polygon=(dx*dy)/(w*h);
  const geometry=(tr.distance+bl.distance)/(dx+dy);
  const quality=(tl.quality+tr.quality+bl.quality+br.quality)/4;
  const score=polygon*8+quality-geometry*5;
  if(score>bestScore){bestScore=score;best={tl,tr,bl,br,horizontal:dx,vertical:dy}}
 }
 if(best)return {corners:best,count:4,points:best};
 // Candidates are not validated fiducials. Never display them as 3/4 corners
 // or put green rings on QR-code finder patterns.
 return {corners:null,count:0,points:[]};
}
function sample(mask,w,h,x,y,rx,ry){
 const xa=Math.max(0,Math.floor(x-rx)),xb=Math.min(w-1,Math.ceil(x+rx));
 const ya=Math.max(0,Math.floor(y-ry)),yb=Math.min(h-1,Math.ceil(y+ry));
 let filled=0,total=0;
 for(let yy=ya;yy<=yb;yy++)for(let xx=xa;xx<=xb;xx++){
  const dx=(xx-x)/rx,dy=(yy-y)/ry;
  if(dx*dx+dy*dy>1)continue;
  filled+=mask[yy*w+xx];total++;
 }
 return total?filled/total:0;
}

function sampleGray(gray,w,h,x,y,rx,ry){
 const xa=Math.max(0,Math.floor(x-rx)),xb=Math.min(w-1,Math.ceil(x+rx));
 const ya=Math.max(0,Math.floor(y-ry)),yb=Math.min(h-1,Math.ceil(y+ry));
 let sum=0,count=0;
 for(let j=ya;j<=yb;j++)for(let i=xa;i<=xb;i++){
  if(((i-x)/rx)**2+((j-y)/ry)**2>.85)continue;
  sum+=gray[j*w+i];count++;
 }
 return count?sum/count:255;
}
// Fast tracking by contrasting dark border, pale ring and dark center.
function trackCorners(gray,w,h,last){
 if(!last)return null;
 const out={},radius=Math.max(9,Math.min(24,Math.round(Math.min(w,h)*.045)));
 function pixel(x,y){x=Math.round(x);y=Math.round(y);return x>=0&&y>=0&&x<w&&y<h?gray[y*w+x]:255}
 for(const id of ['tl','tr','bl','br']){
  const old=last[id],size=old.size||Math.min(w,h)*.035;
  const radiusOuter=size*.46,radiusRing=size*.30,radiusCore=size*.095;
  let best=null;
  for(let dy=-radius;dy<=radius;dy+=3)for(let dx=-radius;dx<=radius;dx+=3){
   const x=old.x+dx,y=old.y+dy;
   if(x-radiusOuter<1||x+radiusOuter>=w||y-radiusOuter<1||y+radiusOuter>=h)continue;
   let dark=0,light=0,core=0;
   for(let k=0;k<8;k++){
    const angle=Math.PI*2*k/8,co=Math.cos(angle),si=Math.sin(angle);
    dark+=pixel(x+co*radiusOuter,y+si*radiusOuter);
    light+=pixel(x+co*radiusRing,y+si*radiusRing);
    core+=pixel(x+co*radiusCore,y+si*radiusCore);
   }
   const contrast=light/8-(dark/8+core/8)/2;
   if(contrast<20)continue;
   const score=contrast-Math.hypot(dx,dy)*.16;
   if(!best||score>best.score)best={x,y,size,quality:old.quality||1,score};
  }
  if(!best)return null;
  out[id]=best;
 }
 const top=Math.hypot(out.tr.x-out.tl.x,out.tr.y-out.tl.y);
 const bottom=Math.hypot(out.br.x-out.bl.x,out.br.y-out.bl.y);
 const left=Math.hypot(out.bl.x-out.tl.x,out.bl.y-out.tl.y);
 const right=Math.hypot(out.br.x-out.tr.x,out.br.y-out.tr.y);
 if(top<w*.25||left<h*.18||Math.max(top,bottom)/Math.min(top,bottom)>1.4||
    Math.max(left,right)/Math.min(left,right)>1.45)return null;
 return {...out,horizontal:(top+bottom)/2,vertical:(left+right)/2};
}

function locate(mask,w,h,anchors){
 // Perspective homography: simple bilinear interpolation was shifted by up
 // to 15 pixels in the user's angled photo — more than a filled square width.
 const cornerPoint=(u,v)=>{
  const {tl,tr,bl,br}=anchors;
  const dx1=tr.x-br.x,dy1=tr.y-br.y;
  const dx2=bl.x-br.x,dy2=bl.y-br.y;
  const dx3=tl.x-tr.x+br.x-bl.x,dy3=tl.y-tr.y+br.y-bl.y;
  const determinant=dx1*dy2-dx2*dy1;
  if(Math.abs(determinant)<1e-6)return {
   x:tl.x*(1-u)*(1-v)+tr.x*u*(1-v)+bl.x*(1-u)*v+br.x*u*v,
   y:tl.y*(1-u)*(1-v)+tr.y*u*(1-v)+bl.y*(1-u)*v+br.y*u*v
  };
  const g=(dx3*dy2-dx2*dy3)/determinant;
  const h=(dx1*dy3-dx3*dy1)/determinant;
  const a=tr.x-tl.x+g*tr.x,b=bl.x-tl.x+h*bl.x;
  const d=tr.y-tl.y+g*tr.y,e=bl.y-tl.y+h*bl.y;
  const scale=1+g*u+h*v;
  return {x:(a*u+b*v+tl.x)/scale,y:(d*u+e*v+tl.y)/scale};
 };
 const orient=(u,v,rotation)=>{
  if(rotation===180)return [1-u,1-v];
  if(rotation===90)return [1-v,u];
  if(rotation===270)return [v,1-u];
  return [u,v];
 };
 const point=(u,v,rotation)=>{
  const [x,y]=orient(u,v,rotation);return cornerPoint(x,y);
 };

 const gray=mask.gray;
 const rx=Math.max(1.7,anchors.horizontal*.0058),ry=Math.max(1.7,anchors.vertical*.0089);
 const cols=[.0377,.0720],step=.0993, valueRows=d=>.5035+d*.0446;
 function measure(du,dv,rotation,collect=false){
  let score=0,good=0;
  const rows=[];
  for(let q=0;q<10;q++){
   const columns=[];
   for(let c=0;c<2;c++){
    const candidates=[];
    for(let d=0;d<(c===0?2:10);d++){
     const p=point(cols[c]+q*step+du,valueRows(d)+dv,rotation);
     const luma=sampleGray(gray,w,h,p.x,p.y,rx,ry);
     candidates.push({digit:d,luma,x:p.x,y:p.y});
    }
    const options=candidates.map(r=>({digit:r.digit,x:r.x,y:r.y,luma:r.luma}));
    candidates.sort((a,b)=>a.luma-b.luma);
    const first=candidates[0],second=candidates[1],gap=second.luma-first.luma;
    const confident=gap>=18&&first.luma<second.luma*.91;
    score+=Math.min(1.6,Math.max(0,gap)/75);
    if(confident)good++;
    if(collect)columns.push({digit:confident?first.digit:null,candidate:first.digit,
      confidence:Math.min(1,gap/90),x:first.x,y:first.y,fill:Math.min(1,gap/120),
      gap,options});
   }
   if(collect)rows.push(columns);
  }
  return {score:score+good*.35,good,rows};
 }
 // The header, top-of-grid and bottom-of-grid lines distinguish the
 // true reading orientation from an upside-down grid that looks like 00s.
 function gridScore(rotation){
  let found=0,total=0;
  for(const y of [.428,.477,.939]){
   for(let i=0;i<=70;i++){
    const p=point(.012+.974*i/70,y,rotation);
    const x=Math.round(p.x),cy=Math.round(p.y);
    if(x<2||x>=w-2||cy<2||cy>=h-2)continue;
    total++;
    if(mask[cy*w+x]||mask[(cy-1)*w+x]||mask[(cy+1)*w+x]||
       mask[cy*w+x-1]||mask[cy*w+x+1])found++;
   }
  }
  return total?found/total:0;
 }
 let best=null;
 for(const rotation of [0,90,180,270]){
  const grid=gridScore(rotation);
  for(const du of [0,-.0035,.0035])
   for(const dv of [0,-.0035,.0035]){
    const m=measure(du,dv,rotation);
    m.rotation=rotation;m.du=du;m.dv=dv;m.gridScore=grid;
    m.score+=grid*28;
    m.score-=(Math.abs(du)+Math.abs(dv))*55;
    if(!best||m.score>best.score)best=m;
   }
 }
 if(best.good<5)return {error:'Cantos encontrados; aproxime para ler os quadradinhos',
  corners:anchors,orientationConfidence:best.good/20,boxes:[],results:[],
  diagnostics:{digits:best.good,stage:'squares',score:best.score,grid:best.gridScore}};
 const orientation=best.rotation,measured=measure(best.du,best.dv,orientation,true);
 const orientationConfidence=best.good/20;
 const boxes=[],results=[];
 for(let q=0;q<10;q++){
  const columns=measured.rows[q];
  const value=columns.every(c=>c.digit!==null)?columns[0].digit*10+columns[1].digit:null;
  const valid=value!==null&&value<=15;
  results.push({columns,value:valid?value:null,rawValue:value,valid,error:value>15?'Somatória acima de 15':null});
  const quad=[
    point(.009+q*step,.429,orientation),
    point(.009+(q+.945)*step,.429,orientation),
    point(.009+(q+.945)*step,.938,orientation),
    point(.009+q*step,.938,orientation)
  ];
  const xs=quad.map(p=>p.x),ys=quad.map(p=>p.y);
  boxes.push({quad,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)});
 }
 return {boxes,results,corners:anchors,orientation,orientationConfidence,
  diagnostics:{digits:best.good,stage:'answers',score:best.score,grid:best.gridScore}};
}
function decode(input){
 const w=input.width,h=input.height;
 const binary=binaryFromRGBA(input);
 let corners=trackCorners(binary.gray,w,h,self.lastVerifiedCorners);
 const tracked=!!corners;
 if(!corners){
  const detection=detectCorners(binary,w,h);
  if(!detection.corners){
   self.lastVerifiedCorners=null;
   return {error:'Enquadre o cartão',boxes:[],results:[],markersFound:0,markerPoints:[]};
  }
  corners=detection.corners;
 }
 const result=locate(binary,w,h,corners);
 if((result.diagnostics?.digits||0)>=9)self.lastVerifiedCorners=corners;
 else if(tracked)self.lastVerifiedCorners=null;
 return {...result,markersFound:4,markerPoints:corners,tracked};
}
self.onmessage=function(event){
 const data=event.data||{};
 if(data.action!=='analyze')return;
 try{self.postMessage({id:data.id,status:'ok',result:decode(data)})}
 catch(e){self.postMessage({id:data.id,status:'error',message:String(e?.message||e)})}
};