import {createPortal} from 'react-dom';
import MediaPlaylist,{generatedPlaylist} from './MediaPlaylist.jsx';
import React,{useState,useEffect,useMemo,useRef} from 'react';
import GenerationDialog from './GenerationDialog.jsx';
import {downloadZip} from './download-zip.js';
import {imageStore} from './character-images.js';
import {dialogue,SpeechReader,SPEECH_LANGUAGES} from './speech.js';
import {mediaSource,restoreVoice} from './project-file.js';
export default function VoiceStudio({playbackTarget,data,onChange,visible}) {
 const [playlist,setPlaylist]=useState(null);
 useEffect(()=>{if(!visible)setPlaylist(null);},[visible]);
 const shots=useMemo(()=>data.project.storyboard.flatMap(s=>s.mvinfo),[data]);
 const defaults=useMemo(()=>shots.map(s=>dialogue(s.audio_plan?.audio_text??s.lyrics)),[shots]);
 const key=useMemo(()=>JSON.stringify(['voice-studio',data.exported_at,data.project.direction_name,defaults,data._localId]),[data,defaults]);
 const [state,setState]=useState(()=>restoreVoice(data));
 const [packing,setPacking]=useState(false);
 const [generation,setGeneration]=useState(null);
 function updateGeneration(index,status,detail){setGeneration(g=>g&&({...g,rows:g.rows.map(r=>r.index===index?{...r,status,detail}:r)}));}
 function stopGeneration(){abort.current?.abort();setGeneration(null);}
 const [ready,setReady]=useState(false),[voices,setVoices]=useState([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[errors,setErrors]=useState({}),[storageError,setStorageError]=useState('');
 const [speech,setSpeech]=useState({}),[language,setLanguage]=useState('zh-CN');
 const abort=useRef(null),mounted=useRef(true),lock=useRef(false),audioRefs=useRef([]);
 const reader=useMemo(()=>new SpeechReader({synth:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,onState:setSpeech}),[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();reader.stop();};},[reader]);
 useEffect(()=>{if(!visible){reader.stop();audioRefs.current.forEach(a=>a?.pause());}},[visible,reader]);
 useEffect(()=>{reader.stop();},[language,reader]);
 useEffect(()=>{
  let active=true;
  imageStore(key).then(async saved=>{const next=saved&&Array.isArray(saved.texts)&&saved.texts.length===defaults.length?saved:restoreVoice(data);await Promise.all(Object.entries(next.clips).map(async([index,clip])=>{if(clip.dataUrl||!mediaSource(clip.url,'audio'))return;try{const res=await fetch(clip.url);if(!res.ok)throw new Error();const blob=await res.blob();clip.dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}catch{if(active)setStorageError('部分已保存配音无法读取，请检查本机音频文件。');}}));if(active)setState(next);}).catch(e=>{if(active)setStorageError(e.message);}).finally(()=>{if(active)setReady(true);});
  const controller=new AbortController();
  fetch('/api/tts/voices',{signal:controller.signal}).then(async res=>{if(!res.ok)throw new Error('无法加载 Edge TTS 音色，请确认后端已启动。');return res.json();}).then(v=>{if(active)setVoices(v.voices);}).catch(e=>{if(active&&e.name!=='AbortError')setProgress(e.message);});
  return()=>{active=false;controller.abort();};
 },[key,defaults]);
 useEffect(()=>{if(!ready)return;onChange(state);imageStore(key,state).catch(e=>{if(mounted.current)setStorageError(e.message);});},[state,ready,key,onChange]);
 const entries=state.texts.map((text,i)=>({key:`voice-${i}`,label:shots[i].shot_id||`镜头 ${i+1}`,text:dialogue(text)}));
 async function zipAudio(){setPacking(true);try{await downloadZip(Object.entries(state.clips).map(([i,c])=>({name:(shots[i].shot_id||'shot-'+(Number(i)+1))+'.mp3',url:c.dataUrl||c.url})),'director-audio.zip',setProgress);}catch(e){setProgress(e.message);}finally{if(mounted.current)setPacking(false);}}
 function pauseAudio(){reader.stop();audioRefs.current.forEach(a=>a?.pause());}
 async function generate(indices){
  if(lock.current)return;lock.current=true;setBusy(true);pauseAudio();setErrors({});
  const snapshot=state,controller=new AbortController();abort.current=controller;let failed=0,completed=0;
  setGeneration({rows:indices.map(i=>({index:i,label:shots[i].shot_id||`镜头 ${i+1}`,status:'waiting'}))});
  try {
   for(let n=0;n<indices.length;n++){
    if(!mounted.current||controller.signal.aborted)break;
    const i=indices[n];updateGeneration(i,'running');setProgress(`正在生成 ${n+1}/${indices.length} · ${shots[i].shot_id||'镜头 '+(i+1)}`);
    try{
     const res=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:snapshot.texts[i],voice:snapshot.voice}),signal:controller.signal});
     const clip=await res.json();if(!res.ok)throw new Error(clip.error||'配音生成失败。');
     const media=await fetch(clip.url,{signal:controller.signal});if(!media.ok)throw new Error('音频读取失败，请重试。');
     const blob=await media.blob();
     const dataUrl=await new Promise((resolve,reject)=>{const file=new FileReader();file.onload=()=>resolve(file.result);file.onerror=()=>reject(new Error('音频保存失败。'));file.readAsDataURL(blob);});
     if(mounted.current&&!controller.signal.aborted){setState(s=>({...s,clips:{...s.clips,[i]:{...clip,dataUrl}}}));completed++;updateGeneration(i,'completed');}
    }catch(e){if(e.name==='AbortError'||controller.signal.aborted)break;failed++;if(mounted.current){setErrors(old=>({...old,[i]:e.message}));updateGeneration(i,'failed',e.message);}}
   }
   if(mounted.current)setProgress(`${controller.signal.aborted?'配音已停止':'配音处理完成'}：成功 ${completed} 条${failed?`，失败 ${failed} 条，可逐条重试`:''}。`);
  }finally{lock.current=false;if(mounted.current){setBusy(false);setGeneration(null);}}
 }
 function edit(i,text){reader.stop();setState(s=>({...s,texts:s.texts.map((t,n)=>n===i?text:t)}));setErrors(e=>({...e,[i]:''}));}
 return <div hidden={!visible} className="voice-studio">{playlist&&<MediaPlaylist items={playlist} type="audio" onClose={()=>setPlaylist(null)}/>}{visible&&playbackTarget&&createPortal(<div className="studio-playback-row"><button type="button" className="small-button" disabled={!ready||busy||!Object.values(state.clips).some(c=>c?.dataUrl||c?.url)} onClick={()=>{pauseAudio();setPlaylist(generatedPlaylist(shots,state,'audio'));}}>▶ 播放全部生成的配音</button></div>,playbackTarget)}{generation&&<GenerationDialog title="配音生成中" rows={generation.rows} onStop={stopGeneration}/>}<div className="tts-toolbar"><div><h3>配音工作台</h3><p>编辑台词后生成 MP3，或使用设备语音快速朗读。</p></div><div className="speech-actions"><select aria-label="Edge TTS 配音音色" value={state.voice} disabled={busy||!ready||!voices.length} onChange={e=>setState(s=>({...s,voice:e.target.value}))}>{voices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select><button type="button" className="small-button save-image" disabled={busy||!ready||!voices.length||!entries.some(e=>e.text&&e.text.length<=5000)} onClick={()=>generate(entries.flatMap((e,i)=>e.text&&e.text.length<=5000?[i]:[]))}>{busy?'正在生成配音…':'生成全部配音'}</button><button className="small-button" type="button" disabled={busy||packing||!Object.keys(state.clips).length} onClick={zipAudio}>{packing?'正在打包…':'下载已生成配音（ZIP）'}</button></div></div><p className="tts-note">Edge TTS 将台词发送至 Microsoft 在线语音服务。生成音频不自动匹配镜头时长。</p><div className="speech-toolbar"><div className="speech-actions"><select aria-label="朗读语言" value={language} onChange={e=>setLanguage(e.target.value)}>{Object.entries(SPEECH_LANGUAGES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><button type="button" className="small-button" disabled={!reader.supported||!entries.some(e=>e.text)||busy} onClick={()=>{pauseAudio();reader.play(entries,language);}}>▶ 全部朗读</button><button type="button" className="small-button" disabled={!speech.active} onClick={()=>reader.togglePause()}>{speech.paused?'继续':'暂停'}</button><button type="button" className="small-button" disabled={!speech.active} onClick={()=>reader.stop()}>停止</button></div></div><p className="speech-status" role="status">{progress||'台词与生成音频会自动保存到当前浏览器。'}</p><p className="speech-status" role="status">{speech.message||(!reader.supported?'当前浏览器不支持设备语音朗读。':'')}</p>{storageError&&<p className="asset-message" role="alert">{storageError} 请下载项目 JSON 备份。</p>}{shots.map((shot,i)=>{
 const clip=state.clips[i],stale=clip&&(clip.text!==state.texts[i].trim()||clip.voice!==state.voice);
 return <article className={`project-article ${speech.key===entries[i].key?'speaking':''}`} key={i}><div className="dialogue-heading"><h3>{shot.shot_id||`镜头 ${i+1}`} <small>{shot.timestamp}</small></h3><div className="speech-actions"><button type="button" className="small-button" disabled={busy||!ready||!voices.length||!entries[i].text||state.texts[i].length>5000} onClick={()=>generate([i])}>生成配音</button><button type="button" className="small-button" disabled={!reader.supported||!entries[i].text||busy} onClick={()=>{if(speech.key===entries[i].key&&speech.active)reader.stop();else{pauseAudio();reader.play([entries[i]],language);}}}>{speech.key===entries[i].key&&speech.active?'■ 停止朗读':'▶ 逐条朗读'}</button></div></div><label className="voice-label" htmlFor={`voice-text-${i}`}>台词 / 旁白 <span>{state.texts[i].length} / 5,000</span></label><textarea id={`voice-text-${i}`} className="voice-textarea" maxLength={5000} value={state.texts[i]} disabled={busy||!ready} placeholder="输入此镜头的台词或旁白；留空则跳过配音。" onChange={e=>edit(i,e.target.value)}/>{errors[i]&&<p className="tts-error" role="alert">{errors[i]}</p>}{clip&&<div className="generated-voice"><audio onError={()=>setErrors(e=>({...e,[i]:'音频路径不可用，请检查原电脑的 .local/audio 文件。导入不会自动重新生成。'}))} ref={a=>audioRefs.current[i]=a} controls preload="none" src={clip.dataUrl||clip.url} onPlay={()=>{reader.stop();audioRefs.current.forEach((a,n)=>{if(n!==i)a?.pause();});}}/><a className="small-button" href={clip.dataUrl||clip.url} download={`${(shot.shot_id||`shot-${i+1}`).replace(/[^a-zA-Z0-9_-]/g,'_')}.mp3`}>下载 MP3</a><p className={stale?'tts-error':'image-hint'}>{stale?'台词或音色已修改，当前为旧音频，请重新生成。':`已生成 · ${voices.find(v=>v.id===clip.voice)?.name||clip.voice}`}</p></div>}</article>;
 })}{!shots.length&&<p>当前项目没有可配音镜头。</p>}</div>;
}
