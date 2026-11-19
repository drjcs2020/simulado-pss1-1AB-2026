import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Alert,ActivityIndicator,Image,Pressable,ScrollView,StyleSheet,Text,TextInput,View,Vibration} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {ANSWER_KEYS,APP_TITLE,ClassId,ExamType,ROSTERS,SCHOOL,Student,lookupStudent,parseStudentQR} from './src/data';
import {grade,Mark,scoreQuestion,toggleBit} from './src/scoring';
import {CardBox,Detection,stableReading} from './src/omr';
import {scanPhotoBase64} from './src/photo-omr';
import {loadEndpoint,pendingGrade,readSheet,resetGrade,saveGrade,setEndpoint} from './src/sheets';

const BLUE='#1e3a8a',GREEN='#16a34a',BG='#f1f5f9',WHITE='#fff';
type Tab='correct'|'grades'|'stats'|'config';
type Mode='none'|'qr'|'qr-success'|'omr';
function format(n:number){return n.toFixed(2).replace('.',',')}
function Bubble({label,active,onPress}:{label:string,active:boolean,onPress:()=>void}){
 return <Pressable onPress={onPress} style={[styles.bubble,active&&styles.bubbleOn]}><Text style={[styles.bubbleText,active&&{color:WHITE}]}>{label}</Text></Pressable>;
}
function Button({label,onPress,kind='primary',disabled=false}:{label:string,onPress:()=>void,kind?:'primary'|'green'|'light'|'orange',disabled?:boolean}){
 return <Pressable disabled={disabled} onPress={onPress} style={[styles.button,styles[kind],disabled&&{opacity:.45}]}><Text style={[styles.buttonText,kind==='light'&&{color:'#1b3554'}]}>{label}</Text></Pressable>;
}
async function readCapturedPhoto(uri:string){
 const ctx=ImageManipulator.ImageManipulator.manipulate(uri,{maxWidth:960,maxHeight:960});
 ctx.resize({width:640});
 const img=await ctx.renderAsync();
 const saved=await img.saveAsync({format:ImageManipulator.SaveFormat.JPEG,compress:.87,base64:true});
 if(!saved.base64)throw Error('A câmera não gerou JPEG');
 return {reading:scanPhotoBase64(saved.base64),saved};
}
function CardCamera({onStable,onPartial,onExit,onReview,stable}:{onStable:(values:number[],boxes:CardBox[])=>void;onPartial:(values:Mark[])=>void;onExit:()=>void;onReview:()=>void;stable:boolean}){
 const camera=useRef<CameraView|null>(null);
 const [permission,requestPermission]=useCameraPermissions();
 const [ready,setReady]=useState(false);
 const [feedback,setFeedback]=useState('● LENDO CARTÃO');
 const [snapshot,setSnapshot]=useState<{uri:string;detection:Detection}|null>(null);
 const bestSnapshotCount=useRef(0);
 const [imageWidth,setImageWidth]=useState(0);
 const previous=useRef({signature:'',count:0});
 const confirmed=useRef(false);
 const running=useRef(false);
 useEffect(()=>{
  if(!permission?.granted)requestPermission().catch(()=>setFeedback('Permissão da câmera negada'));
 },[permission?.granted,requestPermission]);
 useEffect(()=>{
  if(!permission?.granted||!ready||stable)return;
  let stopped=false;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const capture=async()=>{
   if(stopped||running.current||confirmed.current)return;
   running.current=true;
   try{
    // Expo Camera: captura local, sem frame processor, Skia ou Vulkan.
    const picture=await camera.current?.takePictureAsync({quality:.84,skipProcessing:false,shutterSound:false});
    if(!picture?.uri)throw Error('A câmera não entregou a imagem');
    const {reading,saved}=await readCapturedPhoto(picture.uri);
    const detection=reading.detection;
    const valid=reading.accepted;
    if(stopped)return;
    if(valid>0)onPartial(detection.results.map(r=>r.valid?r.value:null));
    setFeedback(valid===10?'✓ 10/10 IDENTIFICADAS':valid>0?`${valid}/10 IDENTIFICADAS`:'● ENQUADRE A GRADE DE RESPOSTAS');
    const next=stableReading(previous.current,detection);
    previous.current={signature:next.signature,count:next.count};
    if(valid>0&&valid>=bestSnapshotCount.current){
      bestSnapshotCount.current=valid;
      // Imagem de conferência realinhada à mesma orientação usada pelo detector.
      const context=ImageManipulator.ImageManipulator.manipulate(saved.uri);
      if(reading.rotation)context.rotate(reading.rotation);
      context.resize({width:640,height:480});
      const displayed=await context.renderAsync();
      const aligned=await displayed.saveAsync({format:ImageManipulator.SaveFormat.JPEG,compress:.85});
      if(!stopped)setSnapshot({uri:aligned.uri,detection});
    }
    if(next.stable&&next.values&&!confirmed.current){
     confirmed.current=true;
     onStable(next.values,detection.boxes);
     setFeedback('✓ LEITURA CONFIRMADA');
    }
   }catch(e){
    if(!stopped)setFeedback('Falha da câmera: '+String(e instanceof Error?e.message:e).slice(0,100));
    previous.current={signature:'',count:0};
   }finally{
    running.current=false;
    if(!stopped&&!confirmed.current)timer=setTimeout(capture,1300);
   }
  };
  timer=setTimeout(capture,600);
  return ()=>{stopped=true;if(timer)clearTimeout(timer)};
 },[permission?.granted,ready,stable,onStable,onPartial]);
 const canShow=!!snapshot&&snapshot.detection.boxes.length===10;
 const circles: Array<{x:number;y:number;r:number;key:string}>=[];
 if(canShow){
  snapshot!.detection.boxes.forEach((box,q)=>{
   const columns=snapshot!.detection.results[q]?.columns||[];
   columns.forEach((col,index)=>{
    if(col.digit===null)return;
    const x=col.x??box.x+box.w*[.224,.382,.539,.696][index];
    const y=col.y??box.y+box.h*.5;
    circles.push({x,y,r:Math.max(4,box.h*.24),key:q+'-'+index});
   });
  });
 }
 return <View style={styles.fullScreen}>
  {permission?.granted?
   <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" active={!stable}
    onCameraReady={()=>setReady(true)} onMountError={e=>setFeedback('Falha ao abrir a câmera: '+e.message)}/>:
   <View style={{padding:24}}><Button label="Permitir câmera" onPress={()=>requestPermission().catch(()=>{})}/></View>}
  {canShow&&<View style={{position:'absolute',top:'20%',left:12,right:12,aspectRatio:4/3,backgroundColor:'#fff'}}
    onLayout={e=>setImageWidth(e.nativeEvent.layout.width)}>
    <Image source={{uri:snapshot!.uri}} style={StyleSheet.absoluteFill} resizeMode="stretch"/>
    {circles.map(c=><View key={c.key} pointerEvents="none" style={{position:'absolute',
     left:(c.x-c.r)*imageWidth/640,top:(c.y-c.r)*imageWidth/640,
     width:2*c.r*imageWidth/640,height:2*c.r*imageWidth/640,
     borderRadius:c.r*imageWidth/640,borderWidth:3,borderColor:'#00de66'}}/>)}
   </View>}
  <View style={styles.cameraTop} pointerEvents="box-none">
   <Pressable onPress={onExit} style={styles.exit}><Text style={styles.whiteText}>✕ Sair</Text></Pressable>
   <View style={styles.liveBadge}><Text style={styles.whiteText}>{feedback}</Text></View>
  </View>
  <View style={styles.cameraReview} pointerEvents="box-none">
   <Pressable onPress={onReview} style={styles.reviewButton}><Text style={styles.whiteText}>Conferir respostas</Text></Pressable>
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
 const [qrPermission,requestQRPermission]=useCameraPermissions();
 const qrHandling=useRef(false);
 const qrTransition=useRef<ReturnType<typeof setTimeout>|null>(null);
 const student=lookupStudent(group,studentNumber)!;
 const score=useMemo(()=>marks.every(m=>m!==null)?grade(marks,student.type).total:0,[marks,student.type]);
 const key=group+'-'+studentNumber;
 useEffect(()=>{loadEndpoint().then(setEndpointText).catch(()=>{});},[]);
 useEffect(()=>{
  if(mode==='qr'&&!qrPermission?.granted)requestQRPermission().catch(()=>setStatus('Permissão para QR negada.'));
 },[mode,qrPermission?.granted,requestQRPermission]);
 useEffect(()=>()=>{if(qrTransition.current)clearTimeout(qrTransition.current)},[]);
 const chooseGroup=(newGroup:ClassId)=>{setGroup(newGroup);setStudentNumber(ROSTERS[newGroup][0].num);setMarks(Array(10).fill(null));edited.current.clear();setStatus('');setIsStable(false)};
 const chooseStudent=(n:number)=>{setStudentNumber(n);setMarks(Array(10).fill(null));edited.current.clear();setIsStable(false);setStatus('')};
 const enterQR=()=>{qrHandling.current=false;setStatus('');setMode('qr')};
 const enterOMR=()=>{edited.current.clear();setLastBoxes([]);setIsStable(false);setStatus('');setLiveFeedback('');setMode('omr')};
 const partialCallback=useCallback((values:Mark[])=>{
  setMarks(current=>values.map((v,i)=>edited.current.has(i)?current[i]:v??current[i]));
 },[]);
 const pickPhoto=async()=>{
  setBusy(true);
  try{
   const selected=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:1,allowsEditing:false});
   if(selected.canceled||!selected.assets?.length)return;
   const {reading}=await readCapturedPhoto(selected.assets[0].uri);
   const num=reading.accepted;
   if(num===0){setStatus('Nenhuma resposta reconhecida. Enquadre somente o cartão e tente uma foto mais nítida.');return;}
   edited.current.clear();
   setMarks(reading.detection.results.map(q=>q.valid?q.value:null));
   setIsStable(num===10);
   setStatus(num===10?'10 respostas identificadas pela foto. Confira e salve.':num+'/10 identificadas pela foto. Complete as demais manualmente antes de salvar.');
  }catch(e:any){setStatus('Erro ao ler foto: '+(e?.message||String(e)))}
  finally{setBusy(false)}
 };
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
 if(mode==='omr')return <CardCamera onStable={stableCallback} onPartial={partialCallback} onExit={()=>setMode('none')} onReview={()=>setMode('none')} stable={isStable}/>;
 return <View style={styles.main}>
  <View style={styles.header}><Text style={styles.appName}>{APP_TITLE}</Text><Text style={styles.school}>{SCHOOL}</Text></View>
  <View style={styles.tabs}>{([['correct','Escanear & Corrigir'],['grades','Boletim'],['stats','Estatísticas'],['config','Planilha']] as const).map(([id,title])=>
   <Pressable key={id} onPress={()=>setTab(id)} style={[styles.tab,tab===id&&styles.tabActive]}><Text style={[styles.tabText,tab===id&&{color:WHITE}]}>{title}</Text></Pressable>)}</View>
  <ScrollView contentContainerStyle={{padding:10,paddingBottom:28}}>
   {tab==='correct'&&<>
    <View style={styles.card}><View style={styles.row}><Button label="📷 Ler QR Code" onPress={enterQR}/><Button label="▣ Ler cartão" kind="green" onPress={enterOMR}/><Button label="Ler foto" kind="light" onPress={pickPhoto} disabled={busy}/></View>
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
 cameraReview:{position:'absolute',top:'79%',right:14,zIndex:12},
 reviewButton:{backgroundColor:'#166534',paddingVertical:18,paddingHorizontal:16,borderRadius:12,minWidth:164,alignItems:'center',borderWidth:2,borderColor:'#bbf7d0'},
 exit:{backgroundColor:'#172554cb',padding:14,borderRadius:12},whiteText:{color:'white',fontWeight:'800'},liveBadge:{padding:10,backgroundColor:'#14532dcb',borderRadius:10}
});
