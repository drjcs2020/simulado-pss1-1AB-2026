const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const source=fs.readFileSync('printed-card.js','utf8');
const core={};
vm.runInNewContext(source,{self:core});
const text=fs.readFileSync('android-native/tests/fixtures/printed-matrix.ts','utf8');
const compressed=text.match(/compressed:"([^"]+)"/)?.[1];
assert.ok(compressed,'fixture PDF real ausente');
const binary=new Uint8Array(zlib.inflateSync(Buffer.from(compressed,'base64')));
const width=400,height=300,expected=[1,2,4,8,15,0,5,11,10,7];
assert.equal(binary.length,width*height);
function imageData(rotation=0,contrast=false){
 const sw=rotation===90?height:width,sh=rotation===90?width:height;
 const pixels=new Uint8Array(sw*sh*4);
 for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
  let sx=x,sy=y;
  if(rotation===180){sx=width-1-x;sy=height-1-y}
  if(rotation===90){sx=y;sy=height-1-x}
  const ink=binary[sy*width+sx]===255,gray=contrast?(ink?65:203):(ink?0:255);
  const i=(y*sw+x)*4;pixels[i]=gray;pixels[i+1]=gray;pixels[i+2]=gray;pixels[i+3]=255;
 }
 return {width:sw,height:sh,pixels:pixels.buffer};
}
const mock={last:null,postMessage(r){this.last=r}};
vm.runInNewContext(fs.readFileSync('omr-worker.js','utf8'),{self:mock,importScripts(){},decodePrintedCard:core.decodePrintedCard});
function verify(name,angle,contrast){
 const img=imageData(angle,contrast);
 mock.onmessage({data:{action:'analyze',id:2,...img}});
 assert.equal(mock.last.status,'ok',name+': '+mock.last.message);
 const got=mock.last.result.results.map(r=>r.value);
 assert.equal(JSON.stringify(got),JSON.stringify(expected),name+': '+JSON.stringify(got));
 assert.equal(mock.last.result.boxes.length,10,name+' 10 linhas');
 assert.ok(mock.last.result.results.every(r=>r.columns.length===4),name+' 4 círculos');
 console.log('PASS',name,got.join(','));
}
verify('PDF real, preenchimento azul-preto',0,false);
verify('PDF real girado 180°',180,false);
verify('PDF real girado 90°',90,false);
verify('PDF real com menor contraste',0,true);
const blank=new Uint8Array(width*height*4).fill(255);
mock.onmessage({data:{action:'analyze',id:3,width,height,pixels:blank.buffer}});
assert.equal(mock.last.result.results.length,0);
console.log('PASS: foto em branco não gera nota falsa');
