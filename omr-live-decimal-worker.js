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
 for(let i=0;i<gray.length;i++)gray[i]=gray[i]<=threshold?1:0;
 return gray;
}
function detectCorners(mask,w,h){
 const result={};
 for(const roi of MARKER_ROIS){
  const x0=Math.floor(roi.x0*w),x1=Math.floor(roi.x1*w);
  const y0=Math.floor(roi.y0*h),y1=Math.floor(roi.y1*h);
  const rw=x1-x0,rh=y1-y0;
  const visited=new Uint8Array(rw*rh),queue=new Int32Array(rw*rh);
  const minSize=Math.max(9,Math.floor(Math.min(w,h)*.017));
  const maxSize=Math.max(32,Math.floor(Math.min(w,h)*.18));
  let selected=null;
  for(let yy=0;yy<rh;yy++)for(let xx=0;xx<rw;xx++){
   const index=yy*rw+xx;
   if(visited[index]||!mask[(yy+y0)*w+xx+x0])continue;
   let head=0,tail=1,count=0,minX=xx,maxX=xx,minY=yy,maxY=yy;
   queue[0]=index;visited[index]=1;
   while(head<tail){
    const idx=queue[head++],cx=idx%rw,cy=(idx/rw)|0;
    count++;
    if(cx<minX)minX=cx;if(cx>maxX)maxX=cx;
    if(cy<minY)minY=cy;if(cy>maxY)maxY=cy;
    const ns=[cx>0?idx-1:-1,cx<rw-1?idx+1:-1,cy>0?idx-rw:-1,cy<rh-1?idx+rw:-1];
    for(let k=0;k<4;k++){
     const next=ns[k];
     if(next<0||visited[next])continue;
     visited[next]=1;
     const ny=(next/rw)|0,nx=next-ny*rw;
     if(mask[(ny+y0)*w+nx+x0])queue[tail++]=next;
    }
   }
   const bw=maxX-minX+1,bh=maxY-minY+1,fill=count/(bw*bh);
   if(bw<minSize||bh<minSize||bw>maxSize||bh>maxSize)continue;
   if(bw/bh<.70||bw/bh>1.40||fill<.28||fill>.87)continue;
   const centerX=x0+(minX+maxX)/2,centerY=y0+(minY+maxY)/2;
   const dx=roi.name.endsWith('l')?centerX/w:1-centerX/w;
   const dy=roi.name[0]==='t'?centerY/h:1-centerY/h;
   const score=(dx*dx+dy*dy)*6+Math.abs(fill-.59)*.16+Math.abs(bw/bh-1)*.20;
   if(!selected||score<selected.score)selected={x:centerX,y:centerY,score,size:(bw+bh)/2};
  }
  result[roi.name]=selected;
 }
 if(!result.tl||!result.tr||!result.bl||!result.br)return null;
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const horizontal=(distance(result.tl,result.tr)+distance(result.bl,result.br))/2;
 const vertical=(distance(result.tl,result.bl)+distance(result.tr,result.br))/2;
 if(horizontal<w*.30||vertical<h*.25)return null;
 return {tl:result.tl,tr:result.tr,bl:result.bl,br:result.br,horizontal,vertical};
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
function locate(mask,w,h,anchors){
 const cornerPoint=(u,v)=>{
  const a=anchors;
  return {x:a.tl.x*(1-u)*(1-v)+a.tr.x*u*(1-v)+a.bl.x*(1-u)*v+a.br.x*u*v,
          y:a.tl.y*(1-u)*(1-v)+a.tr.y*u*(1-v)+a.bl.y*(1-u)*v+a.br.y*u*v};
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
 const inkNear=(p)=>{
  const x=Math.round(p.x),y=Math.round(p.y);
  if(x<2||x>=w-2||y<2||y>=h-2)return 0;
  return mask[y*w+x]||mask[(y-1)*w+x]||mask[(y+1)*w+x]||mask[y*w+x-1]||mask[y*w+x+1]?1:0;
 };
 let orientation=0,confidence=-1;
 for(const degrees of [0,90,180,270]){
  let found=0,total=0;
  for(const y of [.428,.477,.939]){
   for(let i=0;i<=70;i++){
    const u=.012+.974*i/70;
    found+=inkNear(point(u,y,degrees));total++;
   }
  }
  const ratio=found/total;
  if(ratio>confidence){confidence=ratio;orientation=degrees}
 }
 if(confidence<.54)return {error:'Enquadre a grade completa do cartão',corners:anchors,orientationConfidence:confidence,boxes:[],results:[]};
 const rx=Math.max(2,anchors.horizontal*.0055),ry=Math.max(2,anchors.vertical*.0080);
 const cols=[.0377,.0720],step=.0993;
 const valueRows=d=>.5035+d*.0446;
 const boxes=[],results=[];
 for(let q=0;q<10;q++){
  const columns=[];
  for(let c=0;c<2;c++){
   const readings=[];
   for(let d=0;d<(c===0?2:10);d++){
    const p=point(cols[c]+q*step,valueRows(d),orientation);
    const value=sample(mask,w,h,p.x,p.y,rx,ry);
    readings.push({digit:d,fill:value,x:p.x,y:p.y});
   }
   const options=readings.map(r=>({digit:r.digit,x:r.x,y:r.y,fill:r.fill}));
   readings.sort((a,b)=>b.fill-a.fill);
   const first=readings[0],second=readings[1],confident=first.fill>=.69&&first.fill-second.fill>=.16;
   columns.push({digit:confident?first.digit:null,candidate:first.digit,confidence:first.fill-second.fill,
     x:first.x,y:first.y,fill:first.fill,options});
  }
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
 return {boxes,results,corners:anchors,orientation,orientationConfidence:confidence};
}
function decode(input){
 const w=input.width,h=input.height;
 const binary=binaryFromRGBA(input);
 const corners=detectCorners(binary,w,h);
 if(!corners)return {error:'Enquadre os quatro marcadores dos cantos',boxes:[],results:[],markersFound:0};
 const res=locate(binary,w,h,corners);
 return {...res,markersFound:4};
}
self.onmessage=function(event){
 const data=event.data||{};
 if(data.action!=='analyze')return;
 try{self.postMessage({id:data.id,status:'ok',result:decode(data)})}
 catch(e){self.postMessage({id:data.id,status:'error',message:String(e?.message||e)})}
};