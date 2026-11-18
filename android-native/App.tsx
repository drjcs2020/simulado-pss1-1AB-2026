import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,ActivityIndicator,Dimensions,Pressable,ScrollView,StyleSheet,Text,TextInput,View,Vibration} from 'react-native';
import {Skia,PaintStyle} from '@shopify/react-native-skia';
import {CodeScanner} from 'react-native-vision-camera-barcode-scanner';
import {useCameraDevice,useCameraPermission} from 'react-native-vision-camera';
import {SkiaCamera} from 'react-native-vision-camera-skia';
import {useResizer,type GPUFrame} from 'react-native-vision-camera-resizer';
import {Mat,OpenCV,DataTypes,ColorConversionCodes,ThresholdTypes} from 'react-native-fast-opencv';
import {scheduleOnRN} from 'react-native-worklets';
import {useSharedValue} from 'react-native-reanimated';
import {ANSWER_KEYS,APP_TITLE,ClassId,ExamType,ROSTERS,SCHOOL,Student,lookupStudent,parseStudentQR} from './src/data';
import {grade,Mark,scoreQuestion,toggleBit} from './src/scoring';
import {CardBox,Detection,decodeBinary,stableReading} from './src/omr';
import {loadEndpoint,pendingGrade,readSheet,resetGrade,saveGrade,setEndpoint} from './src/sheets';

const BLUE='#1e3a8a',GREEN='#16a34a',BG='#f1f5f9',WHITE='#fff';
const PROCESS_WIDTH=640,PROCESS_HEIGHT=480;
type Tab='correct'|'grades'|'stats'|'config';
type Mode='none'|'qr'|'omr';
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
function LiveCamera({onStable,onExit,onReview,manual,manualChange}:{
 onStable:(values:number[],boxes:CardBox[])=>void;
 onExit:()=>void;onReview:()=>void;manual:Mark[];manualChange:(q:number,n:number)=>void;
}){
 const device=useCameraDevice('back');
 const {resizer}=useResizer({width:PROCESS_WIDTH,height:PROCESS_HEIGHT,channelOrder:'bgr',dataType:'uint8',pixelLayout:'interleaved',scaleMode:'contain'});
 const tracker=useSharedValue({signature:'',count:0,emitted:''});
 const recent=useSharedValue<Detection|null>(null);
 const lastRun=useSharedValue(0);
 const onStableRN=useCallback((values:number[],boxes:CardBox[])=>onStable(values,boxes),[onStable]);
 if(!device)return <View style={styles.fullScreen}><Text style={styles.whiteText}>Câmera traseira não encontrada.</Text><Button label="Sair" onPress={onExit}/></View>;
 return <View style={styles.fullScreen}>
  <SkiaCamera style={StyleSheet.absoluteFill} device={device} isActive={true} orientationSource="interface"
   onFrame={(frame,render)=>{
    'worklet';
    const now=Date.now();
    let found=recent.value;
    if(now-lastRun.value>=350){
     lastRun.value=now;
     let resized:GPUFrame|null=null;
     let src:Mat|null=null,gray:Mat|null=null,bin:Mat|null=null;
     try{
      resized=resizer!.resize(frame) as GPUFrame;
      const pixels=new Uint8Array(resized.getPixelBuffer());
      src=Mat.createFromBuffer('uint8',PROCESS_HEIGHT,PROCESS_WIDTH,3,pixels);
      gray=Mat.create(0,0,DataTypes.CV_8U);
      bin=Mat.create(0,0,DataTypes.CV_8U);
      OpenCV.cvtColor(src,gray,ColorConversionCodes.COLOR_BGR2GRAY);
      OpenCV.threshold(gray,bin,140,255,ThresholdTypes.THRESH_BINARY_INV);
      const buffer=bin.toBuffer('uint8');
      const whiteMarks=decodeBinary(new Uint8Array(buffer),PROCESS_WIDTH,PROCESS_HEIGHT);
      found=whiteMarks.error?null:whiteMarks;
      recent.value=found;
      const stable=stableReading(tracker.value,found);
      tracker.value={signature:stable.signature,count:stable.count,emitted:tracker.value.emitted};
      if(stable.stable&&stable.signature!==tracker.value.emitted&&found?.boxes.length===10&&stable.values){
       tracker.value={signature:stable.signature,count:stable.count,emitted:stable.signature};
       scheduleOnRN(onStableRN,stable.values,found.boxes);
      }
     }catch(error){
      found=null;recent.value=null;
      tracker.value={signature:'',count:0,emitted:tracker.value.emitted};
     }finally{
      bin?.release();gray?.release();src?.release();resized?.dispose();
     }
    }
    render(({canvas,frameTexture})=>{
     canvas.drawImage(frameTexture,0,0);
     if(found?.boxes.length!==10)return;
     // Orientação de câmera e frame conforme exemplo oficial Fast OpenCV + Skia.
     const sx=frame.width/PROCESS_HEIGHT,sy=frame.height/PROCESS_WIDTH;
     for(let q=0;q<10;q++){
      const box=found.boxes[q],values=found.results[q]?.columns;
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
    frame.dispose();
   }}/>
  <View style={styles.cameraTop} pointerEvents="box-none">
    <Pressable onPress={onExit} style={styles.exit}><Text style={styles.whiteText}>✕ Sair</Text></Pressable>
    <View style={styles.liveBadge}><Text style={styles.whiteText}>● LEITURA AO VIVO</Text></View>
  </View>
  <View style={styles.cameraBottom} pointerEvents="box-none">
    <Button label="Conferir respostas" kind="green" onPress={onReview}/>
  </View>
 </View>;
}
export default function App(){
 const [tab,setTab]=useState<Tab>('correct'),[mode,setMode]=useState<Mode>('none');
 const [group,setGroup]=useState<ClassId>('1A'),[studentNumber,setStudentNumber]=useState(ROSTERS['1A'][0].num);
 const [marks,setMarks]=useState<Mark[]>(Array(10).fill(null));
 const [isStable,setIsStable]=useState(false),[status,setStatus]=useState('');
 const [endpoint,setEndpointText]=useState(''),[busy,setBusy]=useState(false);
 const [selectedCorrection,setSelectedCorrection]=useState<number|null>(null);
 const [grades,setGrades]=useState<Record<string,any>>({});
 const [lastBoxes,setLastBoxes]=useState<CardBox[]>([]);
 const edited=useRef(new Set<number>());
 const {hasPermission,requestPermission}=useCameraPermission();
 const student=lookupStudent(group,studentNumber)!;
 const score=useMemo(()=>marks.every(m=>m!==null)?grade(marks,student.type).total:0,[marks,student.type]);
 const key=group+'-'+studentNumber;
 useEffect(()=>{loadEndpoint().then(setEndpointText).catch(()=>{});},[]);
 useEffect(()=>{if(mode!=='none'&&!hasPermission)requestPermission().catch(()=>{})},[mode,hasPermission,requestPermission]);
 const chooseGroup=(newGroup:ClassId)=>{setGroup(newGroup);setStudentNumber(ROSTERS[newGroup][0].num);setMarks(Array(10).fill(null));edited.current.clear();setStatus('');setIsStable(false)};
 const chooseStudent=(n:number)=>{setStudentNumber(n);setMarks(Array(10).fill(null));edited.current.clear();setIsStable(false);setStatus('')};
 const enterQR=()=>{setStatus('');setMode('qr')};
 const enterOMR=()=>{edited.current.clear();setIsStable(false);setStatus('');setMode('omr')};
 const stableCallback=useCallback((values:number[],boxes:CardBox[])=>{
  Vibration.vibrate(75);
  setLastBoxes(boxes);
  setMarks(current=>values.map((v,i)=>edited.current.has(i)?current[i]:v));
  setIsStable(true);
 },[]);
 const onQR=useCallback((scanned:ReadonlyArray<{rawValue?:string|null}>)=>{
  for(const item of scanned){
   const qr=parseStudentQR(item.rawValue||'');
   if(qr){setGroup(qr.group);setStudentNumber(qr.num);setMarks(Array(10).fill(null));
    edited.current.clear();setIsStable(false);setMode('omr');return}
  }
 },[]);
 const changeBit=(q:number,bit:1|2|4|8)=>{edited.current.add(q);setMarks(prev=>prev.map((m,i)=>i===q?toggleBit(m,bit):m));};
 const confirmSave=()=>{
  if(marks.some(v=>v===null)){Alert.alert('Respostas incompletas','Confira as dez questões primeiro.');return}
  Alert.alert('Confirmar nota',student.name+' — '+format(grade(marks,student.type).total)+' pontos',[
   {text:'Cancelar',style:'cancelled'}, {text:'Salvar',onPress:async()=>{
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
 if(mode==='qr')return <View style={styles.fullScreen}>
   {hasPermission?<CodeScanner style={StyleSheet.absoluteFill} isActive={true} barcodeFormats={['qr-code']} onBarcodeScanned={onQR} onError={err=>setStatus(String(err))}/>:<ActivityIndicator color="#fff" size="large"/>}
   <View style={styles.cameraTop}><Button label="✕ Sair" onPress={()=>setMode('none')}/></View>
   <View style={styles.cameraBottom}><Text style={styles.whiteText}>{status||'Aponte para o QR Code do aluno'}</Text></View>
  </View>;
 if(mode==='omr')return <LiveCamera onStable={stableCallback} onExit={()=>setMode('none')} onReview={()=>setMode('none')} manual={marks}
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
 cameraTop:{position:'absolute',top:20,left:16,right:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center',zIndex:10},cameraBottom:{position:'absolute',bottom:25,left:20,right:20,zIndex:10},
 exit:{backgroundColor:'#172554cb',padding:14,borderRadius:12},whiteText:{color:'white',fontWeight:'800'},liveBadge:{padding:10,backgroundColor:'#14532dcb',borderRadius:10}
});
