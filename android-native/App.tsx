import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,TextInput,View,Vibration} from 'react-native';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {Skia,PaintStyle} from '@shopify/react-native-skia';
import {useAsyncRunner,useCameraDevice,useCameraPermission} from 'react-native-vision-camera';
import {SkiaCamera} from 'react-native-vision-camera-skia';
import {useResizer,type GPUFrame} from 'react-native-vision-camera-resizer';
import {Mat,OpenCV,DataTypes,ColorConversionCodes,ThresholdTypes} from 'react-native-fast-opencv';
import {scheduleOnRN} from 'react-native-worklets';
import {useSharedValue} from 'react-native-reanimated';
import {ANSWER_KEYS,APP_TITLE,ClassId,ExamType,ROSTERS,SCHOOL,Student,lookupStudent,parseStudentQR} from './src/data';
import {grade,Mark,scoreQuestion,toggleBit} from './src/scoring';
import {CardBox,Detection,decodeBinary,luminanceToBinary,stableReading} from './src/omr';
import {loadEndpoint,pendingGrade,readSheet,resetGrade,saveGrade,setEndpoint} from './src/sheets';

const BLUE='#1e3a8a',GREEN='#16a34a',BG='#f1f5f9',WHITE='#fff';
const PROCESS_WIDTH=640,PROCESS_HEIGHT=480;
type Tab='correct'|'grades'|'stats'|'config';
type Mode='none'|'qr'|'qr-success'|'omr';
function format(n:number){return n.toFixed(2).replace('.',',')}
const greenPaint=Skia.Paint();
greenPaint.setColor(Skia.Color('#22e87e'));
greenPaint.setStyle(PaintStyle.Stroke);
greenPaint.setStrokeWidth(3.5);
const amberPaint=Skia.Paint();amberPaint.setColor(Skia.Color('#fbbf24'));amberPaint.setStyle(PaintStyle.Stroke);amberPaint.setStrokeWidth(2);
function Bubble({label,active,onPress}:{label:string,active:boolean,onPress:()=>void}){
 return <Pressable onPress={onPress} style={[styles.bubble,active&&styles.bubbleOn]}><Text style={[styles.bubbleText,active&&{color:WHITE}]}>{label}</Text></Pressable>;
}
function Button({label,onPress,kind='primary',disabled=false}:{label:string,onPress:()=>void,kind?:'primary'|'green'|'light'|'orange',disabled?:boolean}){
 return <Pressable disabled={disabled} onPress={onPress} style={[styles.button,styles[kind],disabled&&{opacity:.45}]}><Text style={[styles.buttonText,kind==='light'&&{color:'#1b3554'}]}>{label}</Text></Pressable>;
}
function LiveCamera({onStable,onExit,onReview,manual,boxes,stable,feedback,onFeedback,manualChange}:{
 onStable:(values:number[],boxes:CardBox[])=>void;
 onExit:()=>void;onReview:()=>void;manual:Mark[];boxes:CardBox[];stable:boolean;feedback:string;onFeedback:(text:string)=>void;manualChange:(q:number,n:number)=>void;
}){
 const device=useCameraDevice('back');
 const asyncRunner=useAsyncRunner();
 const {resizer,error:resizerError}=useResizer({width:PROCESS_WIDTH,height:PROCESS_HEIGHT,channelOrder:'bgr',dataType:'uint8',pixelLayout:'interleaved',scaleMode:'contain'});
 const tracker=useSharedValue({signature:'',count:0,emitted:''});
 const recent=useSharedValue<Detection|null>(null);
 const lastRun=useSharedValue(0);
 const lastFeedbackAt=useSharedValue(0);
 const lastFeedback=useSharedValue('');
 const [previewSize,setPreviewSize]=useState({width:0,height:0});
 const onStableRN=useCallback((values:number[],boxes:CardBox[])=>onStable(values,boxes),[onStable]);
 const onFeedbackRN=useCallback((text:string)=>onFeedback(text),[onFeedback]);
 useEffect(()=>{
  if(resizerError)onFeedback('Processamento CPU ativado; GPU indisponível.');
 },[resizerError,onFeedback]);
 if(!device)return <View style={styles.fullScreen}><Text style={styles.whiteText}>Câmera traseira não encontrada.</Text><Button label="Sair" onPress={onExit}/></View>;
 return <View style={styles.fullScreen} onLayout={e=>setPreviewSize({width:e.nativeEvent.layout.width,height:e.nativeEvent.layout.height})}>
  <SkiaCamera style={StyleSheet.absoluteFill} device={device} isActive={true} orientationSource="interface" pixelFormat="yuv"
   onError={e=>onFeedback('Erro de câmera: '+String(e.message||e))}
   onFrame={(frame,render)=>{
    'worklet';
    // Renderizar a prévia SEM esperar OpenCV ou o detector das respostas.
    const latest=recent.value;
    render(({canvas,frameTexture})=>{
     canvas.drawImage(frameTexture,0,0);
     if(latest?.boxes.length!==10)return;
     const sx=frame.width/PROCESS_HEIGHT,sy=frame.height/PROCESS_WIDTH;
     for(let q=0;q<10;q++){
      const box=latest.boxes[q],values=latest.results[q]?.columns;
      if(!values)continue;
      for(let col=0;col<2;col++){
       const digit=values[col]?.digit;
       if(digit===null||digit===undefined)continue;
       const u=col===0?.329:.673,v=.149+.0855*digit;
       const cx=box.x+box.w*u,cy=box.y+box.h*v;
       canvas.drawCircle((PROCESS_HEIGHT-cy)*sx,cx*sy,Math.max(7,box.w*.065*sx),greenPaint);
      }
     }
    });
    // Analisar no máximo 2,8 vezes por segundo; a câmera permanece fluida.
    const now=Date.now();
    if(now-lastRun.value<700){frame.dispose();return;}
    lastRun.value=now;
    const queued=asyncRunner.runAsync(()=>{
     'worklet';
     let resized:GPUFrame|null=null,src:Mat|null=null,gray:Mat|null=null,bin:Mat|null=null;
     try{
      let mask:Uint8Array;
      let gpuSucceeded=false;
      if(resizer!=null){
        try {
        // GPU rápida, quando Vulkan funciona no aparelho.
        resized=resizer.resize(frame) as GPUFrame;
        const pixels=new Uint8Array(resized.getPixelBuffer());
        src=Mat.createFromBuffer('uint8',PROCESS_HEIGHT,PROCESS_WIDTH,3,pixels);
        gray=Mat.create(0,0,DataTypes.CV_8U);
        bin=Mat.create(0,0,DataTypes.CV_8U);
        OpenCV.cvtColor(src,gray,ColorConversionCodes.COLOR_BGR2GRAY);
        OpenCV.threshold(gray,bin,0,255,ThresholdTypes.THRESH_BINARY_INV | ThresholdTypes.THRESH_OTSU);
        const binary=bin.toBuffer('uint8');
        mask=new Uint8Array(binary.buffer);
        gpuSucceeded=true;
        }catch(_gpuError){
          // Falha de shader, memória Vulkan ou conversão não impede CPU.
        }
      }
      if(!gpuSucceeded){
        // Fallback obrigatório: usa o plano de luminância YUV da câmera.
        // Não depende de Vulkan nem de OpenCV para reconhecer o cartão.
        const planes=frame.getPlanes();
        const plane=planes[0];
        if(!plane)throw Error('Câmera sem plano YUV legível');
        mask=luminanceToBinary(
          new Uint8Array(plane.getPixelBuffer()),
          plane.width,plane.height,plane.bytesPerRow,PROCESS_WIDTH,PROCESS_HEIGHT
        );
      }
      const output=decodeBinary(mask,PROCESS_WIDTH,PROCESS_HEIGHT);
      const found=output.error?null:output;
      recent.value=found;
      const valid=found?.results.filter(r=>r.valid).length??0;
      const next=valid+'/10';
      if(next!==lastFeedback.value&&Date.now()-lastFeedbackAt.value>950){
        lastFeedback.value=next;
        lastFeedbackAt.value=Date.now();
        scheduleOnRN(onFeedbackRN,next);
      }
      const stable=stableReading(tracker.value,found);
      tracker.value={signature:stable.signature,count:stable.count,emitted:tracker.value.emitted};
      if(stable.stable&&stable.signature!==tracker.value.emitted&&found?.boxes.length===10&&stable.values){
       tracker.value={signature:stable.signature,count:stable.count,emitted:stable.signature};
       scheduleOnRN(onStableRN,stable.values,found.boxes);
      }
     }catch(e){
      const detail='Falha na leitura: '+String(e instanceof Error?e.message:e).slice(0,110);
      if(detail!==lastFeedback.value&&Date.now()-lastFeedbackAt.value>1300){
        lastFeedback.value=detail;lastFeedbackAt.value=Date.now();
        scheduleOnRN(onFeedbackRN,detail);
      }
      recent.value=null;
      tracker.value={signature:'',count:0,emitted:tracker.value.emitted};
     }finally{
      bin?.release();gray?.release();src?.release();resized?.dispose();frame.dispose();
     }
    });
    if(!queued)frame.dispose();
   }}/>
  {boxes.length===10&&previewSize.width>0&&<Pressable style={StyleSheet.absoluteFill} onPress={e=>{
    // Mesmo mapeamento de orientação 90° usado na camada Skia.
    const x=e.nativeEvent.locationX,y=e.nativeEvent.locationY;
    const px=(y/previewSize.height)*PROCESS_WIDTH,py=(1-x/previewSize.width)*PROCESS_HEIGHT;
    for(let q=0;q<10;q++){
      const b=boxes[q];
      if(px<b.x||px>b.x+b.w||py<b.y||py>b.y+b.h)continue;
      const digit=Math.round(((py-b.y)/b.h-.149)/.0855),tens=(px-b.x)/b.w<.5;
      if(digit<0||digit>9||(tens&&digit>1))return;
      const prev=manual[q]??0;
      const value=tens?digit*10+prev%10:Math.floor(prev/10)*10+digit;
      if(value<=15)manualChange(q,value);
      return;
    }
   }}/>}
  <View style={styles.cameraTop} pointerEvents="box-none">
    <Pressable onPress={onExit} style={styles.exit}><Text style={styles.whiteText}>✕ Sair</Text></Pressable>
    <View style={styles.liveBadge}><Text style={styles.whiteText}>{stable?'✓ 10/10 CONFIRMADAS':feedback||'● LENDO CARTÃO'}</Text></View>
  </View>
  <View style={styles.cameraReview} pointerEvents="box-none">
    <Pressable onPress={onReview} style={styles.reviewButton}>
      <Text style={styles.whiteText}>Conferir respostas</Text>
    </Pressable>
  </View>
 </View>;
}
export default function App(){
 const [tab,setTab]=useState<Tab>('correct'),[mode,setMode]=useState<Mode>('none');
 const [group,setGroup]=useState<ClassId>('1A'),[studentNumber,setStudentNumber]=useState(ROSTERS['1A'][0].num);
 const [marks,setMarks]=useState<Mark[]>(Array(10).fill(null));
 const [isStable,setIsStable]=useState(false),[status,setStatus]=useState(''),[liveFeedback,setLiveFeedback]=useState('');
 const [endpoint,setEndpointText]=useState(''),[busy,setBusy]=useState(false);
 const [selectedCorrection,setSelectedCorrection]=useState<number|null>(null);
 const [grades,setGrades]=useState<Record<string,any>>({});
 const [lastBoxes,setLastBoxes]=useState<CardBox[]>([]);
 const edited=useRef(new Set<number>());
 const {hasPermission,requestPermission}=useCameraPermission();
 const [qrPermission,requestQRPermission]=useCameraPermissions();
 const qrHandling=useRef(false);
 const qrTransition=useRef<ReturnType<typeof setTimeout>|null>(null);
 const student=lookupStudent(group,studentNumber)!;
 const score=useMemo(()=>marks.every(m=>m!==null)?grade(marks,student.type).total:0,[marks,student.type]);
 const key=group+'-'+studentNumber;
 useEffect(()=>{loadEndpoint().then(setEndpointText).catch(()=>{});},[]);
 useEffect(()=>{
  if(mode==='omr'&&!hasPermission)requestPermission().catch(()=>setStatus('Permissão para câmera negada.'));
 },[mode,hasPermission,requestPermission]);
 useEffect(()=>{
  if(mode==='qr'&&!qrPermission?.granted)requestQRPermission().catch(()=>setStatus('Permissão para QR negada.'));
 },[mode,qrPermission?.granted,requestQRPermission]);
 useEffect(()=>()=>{if(qrTransition.current)clearTimeout(qrTransition.current)},[]);
 const chooseGroup=(newGroup:ClassId)=>{setGroup(newGroup);setStudentNumber(ROSTERS[newGroup][0].num);setMarks(Array(10).fill(null));edited.current.clear();setStatus('');setIsStable(false)};
 const chooseStudent=(n:number)=>{setStudentNumber(n);setMarks(Array(10).fill(null));edited.current.clear();setIsStable(false);setStatus('')};
 const enterQR=()=>{qrHandling.current=false;setStatus('');setMode('qr')};
 const enterOMR=()=>{edited.current.clear();setLastBoxes([]);setIsStable(false);setStatus('');setLiveFeedback('');setMode('omr')};
 const stableCallback=useCallback((values:number[],boxes:CardBox[])=>{
  Vibration.vibrate(75);
  setLastBoxes(boxes);
  setMarks(current=>values.map((v,i)=>edited.current.has(i)?current[i]:v));
  setIsStable(true);
 },[]);
 const onQR=useCallback((data:string)=>{
  if(qrHandling.current)return;
  const qr=parseStudentQR(data);
  if(!qr){setStatus('QR não corresponde ao cartão PSS1.');return;}
  qrHandling.current=true;
  setGroup(qr.group);
  setStudentNumber(qr.num);
  setMarks(Array(10).fill(null));
  edited.current.clear();
  setLastBoxes([]);
  setIsStable(false);
  setLiveFeedback('');
  // Fechar o leitor QR antes de abrir a câmera do cartão: evita duas sessões simultâneas.
  setMode('qr-success');
  qrTransition.current=setTimeout(()=>{qrTransition.current=null;setMode('omr')},600);
 },[]);
 const changeBit=(q:number,bit:1|2|4|8)=>{edited.current.add(q);setMarks(prev=>prev.map((m,i)=>i===q?toggleBit(m,bit):m));};
 const confirmSave=()=>{
  if(marks.some(v=>v===null)){Alert.alert('Respostas incompletas','Confira as dez questões primeiro.');return}
  Alert.alert('Confirmar nota',student.name+' — '+format(grade(marks,student.type).total)+' pontos',[
   {text:'Cancelar',style:'cancel'}, {text:'Salvar',onPress:async()=>{
    setBusy(true);
    try{const total=await saveGrade(endpoint,group,student,marks);setStatus('Nota '+format(total)+' confirmada no Google Sheets.');}
    catch(e:any){setStatus('Gravação não confirmada: '+(e.message||String(e)))}
    finally{setBusy(false)}
   }}
  ]);
 };
 const reset=()=>Alert.alert('Resetar nota', 'Excluir nota de '+student.name+' no aplicativo e na planilha?',[
  {text:'Cancelar',style:'cancel'},{text:'Confirmar',style:'destructive',onPress:async()=>{
    setBusy(true);try{await resetGrade(endpoint,group,student);setMarks(Array(10).fill(null));edited.current.clear();setStatus('Aluno Pendente no Google Sheets.')}
    catch(e:any){setStatus('Reset não confirmado: '+(e.message||String(e)))}
    finally{setBusy(false)}
  }}]);
 const refresh=async()=>{setBusy(true);try{const d=await readSheet(endpoint);setGrades(d.turmas);setStatus('Boletim atualizado.')}catch(e:any){setStatus(e.message||String(e))}finally{setBusy(false)}};
 const setUrl=async()=>{try{await setEndpoint(endpoint);Alert.alert('Planilha','URL salva.')}catch(e:any){Alert.alert('Erro',e.message||String(e))}};
 if(mode==='qr-success')return <View style={styles.fullScreen}><ActivityIndicator color="#fff" size="large"/><Text style={[styles.whiteText,{textAlign:'center',marginTop:12}]}>QR identificado</Text></View>;
 if(mode==='qr')return <View style={styles.fullScreen}>
   {qrPermission?.granted?
     <CameraView style={StyleSheet.absoluteFill} facing="back"
       barcodeScannerSettings={{barcodeTypes:['qr']}}
       onBarcodeScanned={e=>onQR(e.data)}
       onMountError={e=>setStatus('Erro da câmera QR: '+e.message)}/>:
     <View style={{padding:24,gap:12,alignItems:'center'}}>
       <Text style={styles.whiteText}>Autorize a câmera para ler o QR Code.</Text>
       <Button label="Permitir câmera" onPress={()=>requestQRPermission().catch(()=>{})}/>
     </View>}
   <View style={styles.cameraTop}><Pressable onPress={()=>{qrHandling.current=false;setMode('none')}} style={styles.exit}><Text style={styles.whiteText}>✕ Sair</Text></Pressable></View>
   {!!status&&<View style={{position:'absolute',top:96,left:16,right:16}}><Text style={styles.whiteText}>{status}</Text></View>}
  </View>;
 if(mode==='omr'&&!hasPermission)return <View style={styles.fullScreen}><Text style={[styles.whiteText,{textAlign:'center',padding:14}]}>Permissão de câmera necessária.</Text><Button label="Permitir câmera" onPress={()=>requestPermission().catch(()=>{})}/><Button label="Voltar" kind="light" onPress={()=>setMode('none')}/></View>;
 if(mode==='omr')return <LiveCamera onStable={stableCallback} onExit={()=>setMode('none')} onReview={()=>setMode('none')} manual={marks} boxes={lastBoxes} stable={isStable} feedback={liveFeedback} onFeedback={setLiveFeedback}
    manualChange={(q,n)=>{edited.current.add(q);setMarks(m=>m.map((v,i)=>i===q?n:v))}}/>;
 return <View style={styles.main}>
  <View style={styles.header}><Text style={styles.appName}>{APP_TITLE}</Text><Text style={styles.school}>{SCHOOL}</Text></View>
  <View style={styles.tabs}>{([['correct','Escanear & Corrigir'],['grades','Boletim'],['stats','Estatísticas'],['config','Planilha']] as const).map(([id,title])=>
   <Pressable key={id} onPress={()=>setTab(id)} style={[styles.tab,tab===id&&styles.tabActive]}><Text style={[styles.tabText,tab===id&&{color:WHITE}]}>{title}</Text></Pressable>)}</View>
  <ScrollView contentContainerStyle={{padding:10,paddingBottom:28}}>
   {tab==='correct'&&<>
    <View style={styles.card}><View style={styles.row}><Button label="📷 Ler QR Code" onPress={enterQR}/><Button label="▣ Ler cartão" kind="green" onPress={enterOMR}/></View>
      <View style={styles.row}><View style={{flex:1}}><Text style={styles.tiny}>Turma</Text>
       <View style={styles.row}>{(['1A','1B'] as const).map(t=><Button key={t} label={t} kind={t===group?'primary':'light'} onPress={()=>chooseGroup(t)}/>)}</View></View></View>
      <Text style={styles.tiny}>Aluno</Text>
      <ScrollView style={{maxHeight:115}} nestedScrollEnabled>{ROSTERS[group].map(s=><Pressable key={s.num} onPress={()=>chooseStudent(s.num)} style={[styles.studentRow,studentNumber===s.num&&styles.studentSelected]}>
       <Text style={{fontWeight:studentNumber===s.num?'800':'400'}}>{String(s.num).padStart(2,'0')} · {s.name}</Text></Pressable>)}</ScrollView>
      <Text style={styles.studentMeta}>{student.name} · Tipo {student.type} {isStable?'· leitura estável':''}</Text>
    </View>
    <View style={styles.card}><View style={[styles.row,{justifyContent:'space-between'}]}><Text style={styles.section}>Correção das questões</Text><Text style={styles.total}>{format(score)} / 10,00</Text></View>
     {marks.map((m,q)=><View style={styles.question} key={q}><Text style={styles.qName}>Q{String(q+1).padStart(2,'0')}</Text><View style={styles.choice}>{([1,2,4,8] as const).map(bit=>
      <Bubble key={bit} label={String(bit).padStart(2,'0')} active={m!==null&&(m&bit)!==0} onPress={()=>changeBit(q,bit)}/>)}</View>
      <Text style={styles.points}>{m===null?'—':format(scoreQuestion(m,ANSWER_KEYS[student.type][q]))}</Text></View>)}
     <View style={styles.row}><Button label="Salvar" kind="green" onPress={confirmSave} disabled={busy}/><Button label="Limpar" kind="light" onPress={()=>{setMarks(Array(10).fill(null));edited.current.clear()}}/><Button label="Resetar nota" kind="orange" onPress={reset} disabled={busy}/></View>
    </View>
   </>}
   {tab==='grades'&&<View style={styles.card}><Button label="Atualizar boletim" onPress={refresh} disabled={busy}/>{(grades[group]||[]).map((r:any,i:number)=><Text key={i} style={styles.line}>{r['Nº']} · {r.Estudante} · {r.Status} · {r.Nota_Final||'—'}</Text>)}</View>}
   {tab==='stats'&&<View style={styles.card}><Text style={styles.section}>Estatísticas</Text><Text style={styles.line}>Total de alunos: 46</Text><Text style={styles.line}>Correções 1A: {(grades['1A']||[]).filter((x:any)=>x.Status==='Corrigida').length}</Text><Text style={styles.line}>Correções 1B: {(grades['1B']||[]).filter((x:any)=>x.Status==='Corrigida').length}</Text><Button label="Atualizar dados" onPress={refresh}/></View>}
   {tab==='config'&&<View style={styles.card}><Text style={styles.section}>Google Sheets</Text><TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} value={endpoint} onChangeText={setEndpointText} placeholder="URL /exec do Apps Script"/><View style={styles.row}><Button label="Salvar URL" onPress={setUrl}/><Button label="Testar" kind="light" onPress={refresh}/></View></View>}
   {!!status&&<Text style={styles.status}>{status}</Text>}
  </ScrollView>
 </View>;
}
const styles=StyleSheet.create({
 main:{flex:1,backgroundColor:BG},header:{padding:14,backgroundColor:BLUE},appName:{color:WHITE,fontWeight:'800',fontSize:16},school:{color:'#dbeafe',marginTop:3,fontSize:12},
 tabs:{flexDirection:'row',padding:7,gap:5},tab:{flex:1,paddingVertical:10,paddingHorizontal:3,borderRadius:8,backgroundColor:WHITE,borderWidth:1,borderColor:'#cbd5e1'},tabActive:{backgroundColor:BLUE},
 tabText:{fontSize:10,fontWeight:'800',textAlign:'center',color:BLUE},card:{backgroundColor:WHITE,padding:13,borderRadius:12,marginBottom:11,borderWidth:1,borderColor:'#e2e8f0'},
 row:{flexDirection:'row',gap:7,alignItems:'center',marginVertical:6},button:{flex:1,borderRadius:8,paddingVertical:12,paddingHorizontal:6,alignItems:'center'},buttonText:{fontSize:12,fontWeight:'800',color:WHITE,textAlign:'center'},
 primary:{backgroundColor:BLUE},green:{backgroundColor:GREEN},light:{backgroundColor:WHITE,borderColor:'#cbd5e1',borderWidth:1},orange:{backgroundColor:'#d97706'},
 tiny:{fontSize:12,color:'#64748b',marginVertical:4},studentRow:{padding:7,borderBottomWidth:1,borderBottomColor:'#e2e8f0'},studentSelected:{backgroundColor:'#dbeafe',borderRadius:6},studentMeta:{fontSize:12,color:'#64748b',marginTop:8},
 section:{fontWeight:'800',fontSize:14,color:'#0f172a'},total:{fontWeight:'800',color:BLUE,fontSize:17},question:{flexDirection:'row',alignItems:'center',gap:5,padding:7,borderRadius:8,backgroundColor:'#f8fafc',marginVertical:4,borderWidth:1,borderColor:'#e2e8f0'},
 qName:{width:34,fontWeight:'800',fontSize:12},choice:{flex:1,flexDirection:'row',gap:4,justifyContent:'center'},bubble:{height:37,width:37,borderRadius:20,borderWidth:2,borderColor:'#94a3b8',justifyContent:'center',alignItems:'center',backgroundColor:WHITE},bubbleOn:{backgroundColor:'#0f172a',borderColor:'#0f172a'},
 bubbleText:{fontSize:12,fontWeight:'800',color:'#0f172a'},points:{width:42,textAlign:'right',fontSize:12,fontWeight:'800'},input:{borderWidth:1,borderColor:'#94a3b8',borderRadius:8,padding:11,marginVertical:12},
 line:{paddingVertical:8,borderBottomWidth:1,borderColor:'#e2e8f0'},status:{padding:10,fontSize:13,color:'#334155'},fullScreen:{flex:1,backgroundColor:'#030712',justifyContent:'center'},
 cameraTop:{position:'absolute',top:46,left:16,right:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center',zIndex:10},
 cameraReview:{position:'absolute',top:'48%',right:14,zIndex:12},
 reviewButton:{backgroundColor:'#166534',paddingVertical:18,paddingHorizontal:16,borderRadius:12,minWidth:164,alignItems:'center',borderWidth:2,borderColor:'#bbf7d0'},
 exit:{backgroundColor:'#172554cb',padding:14,borderRadius:12},whiteText:{color:'white',fontWeight:'800'},liveBadge:{padding:10,backgroundColor:'#14532dcb',borderRadius:10}
});
