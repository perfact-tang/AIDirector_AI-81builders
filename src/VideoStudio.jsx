import {useI18n} from './LanguageProvider.jsx';
import {createPortal} from 'react-dom';
import MediaPlaylist,{generatedPlaylist} from './MediaPlaylist.jsx';
import React,{useState,useEffect,useMemo,useRef} from 'react';
import GenerationDialog,{Modal} from './GenerationDialog.jsx';
import {imageStore,readImage} from './character-images.js';
import {characterSources,currentVoice,referencePlan} from './video-references.js';
import {compileVideoPrompt} from './compiled-video-prompt.js';
import {restoreVideo} from './project-file.js';
import {downloadZip} from './download-zip.js';
const labels={submitting:'正在上传素材并提交',moderating:'正在审核提示词与素材',translating:'正在准备模型提示词',queued:'已排队，等待生成',in_progress:'正在生成动画',completed:'生成完成',failed:'生成失败',canceled:'任务已结束',submission_unknown:'提交状态待确认，请先检查 ai& 控制台'};
const terminal=job=>['failed','canceled','submission_unknown'].includes(job?.status)||(job?.status==='completed'&&job.url);
function wait(ms,signal){return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
export default function VideoStudio({playbackTarget,data,voiceData,characterImages,imagesReady,visible,onChange}){
 const {t}=useI18n();
 const [playlist,setPlaylist]=useState(null);
 useEffect(()=>{if(!visible)setPlaylist(null);},[visible]);
 const shots=useMemo(()=>data.project.storyboard.flatMap(s=>s.mvinfo),[data]);
 const defaults=useMemo(()=>shots.map(s=>({prompt:s.video_prompt||'',firstPrompt:s.image_prompt||'',seconds:s.generation_plan?.duration_seconds||s.audio_plan?.duration_seconds||5,image:'',useAudio:false,revision:'initial'})),[shots]);
 const key=useMemo(()=>JSON.stringify(['video-studio',data.exported_at,data.project.direction_name,defaults.map(d=>[d.prompt,d.firstPrompt]),data._localId]),[data,defaults]);
 const [state,setState]=useState(()=>restoreVideo(data));
 const [repairing,setRepairing]=useState(null);
 const [confirmAll,setConfirmAll]=useState(false),[generation,setGeneration]=useState(null);
 const activeRequest=useRef(null);
 function updateGeneration(index,status,detail){setGeneration(g=>g&&({...g,rows:g.rows.map(r=>r.index===index?{...r,status,detail}:r)}));}
 function stopGeneration(){activeRequest.current?.abort();setState(s=>({...s,queue:[],paused:false}));setGeneration(null);setMessage('已停止后续生成。已提交的动画仍会继续处理，结果将自动保留。');}
 const [ready,setReady]=useState(false),[config,setConfig]=useState(null),[message,setMessage]=useState(''),[search,setSearch]=useState(''),[packing,setPacking]=useState(false),[uploading,setUploading]=useState(false);
 const mounted=useRef(true),players=useRef([]),stateRef=useRef(state);stateRef.current=state;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!visible)players.current.forEach(v=>v?.pause());},[visible]);
 useEffect(()=>{let active=true;imageStore(key).then(saved=>{if(active&&saved?.drafts?.length===defaults.length){const legacy=saved.queue?.some(q=>!Array.isArray(q.body?.characters)||!q.body.audio);if(legacy){const jobs={...saved.jobs};for(const q of saved.queue){if(jobs[q.index]?.id!==q.body.requestId)jobs[q.index]={id:q.body.requestId,status:'submitting',revision:q.revision,aspect:q.body.aspect,previous:jobs[q.index]?.url?jobs[q.index]:jobs[q.index]?.previous};}setState({...saved,jobs,queue:[],paused:false});}else setState(saved);}}).catch(e=>{if(active)setMessage(e.message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[key,defaults]);
 async function loadConfig(){try{const r=await fetch('/api/videos/config'),c=await r.json();if(!r.ok)throw new Error(c.error);if(mounted.current)setConfig(c);}catch(e){if(mounted.current)setMessage(e.message);}}
 useEffect(()=>{loadConfig();},[]);
 useEffect(()=>{if(!ready)return;onChange(state);imageStore(key,state).catch(e=>{if(mounted.current)setMessage('本地保存失败：'+e.message);});},[ready,state,key,onChange]);
 const head=state.queue[0];
 useEffect(()=>{
  if(!ready||!head||state.paused)return;
  const controller=new AbortController(),signal=controller.signal;activeRequest.current=controller;
  async function run(){
   try{
    updateGeneration(head.index,'running',labels.submitting);
    setState(s=>{const old=s.jobs[head.index];return {...s,jobs:{...s.jobs,[head.index]:{id:head.body.requestId,status:'submitting',revision:head.revision,aspect:head.body.aspect,audioKey:head.audioKey,referenceKey:head.body.referenceKey,previous:old?.url?old:old?.previous}}};});
    let response=await fetch('/api/videos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(head.body),signal});
    let job=await response.json();if(!response.ok){if(response.status===400)job={id:head.body.requestId,status:'failed',error:job.error||'视频参数无效，请调整后重试。'};else throw new Error(job.error||'视频提交失败。');}
    while(!signal.aborted){
     updateGeneration(head.index,terminal(job)?job.status==='completed'?'completed':'failed':'running',job.error||labels[job.status]);
     setState(s=>{if(signal.aborted)return s;const old=s.jobs[head.index];const previous=job.url?undefined:old?.url?{url:old.url,revision:old.revision,aspect:old.aspect,audioKey:old.audioKey,audioLocked:old.audioLocked,audioPolicy:old.audioPolicy,status:'completed'}:old?.previous;return {...s,jobs:{...s.jobs,[head.index]:{...job,revision:head.revision,aspect:head.body.aspect,audioKey:head.audioKey,referenceKey:head.body.referenceKey,previous}}};});
     if(terminal(job))break;
     await wait(15000,signal);
     response=await fetch(`/api/videos/${encodeURIComponent(head.body.requestId)}`,{signal});job=await response.json();if(!response.ok)throw new Error(job.error||'无法读取视频任务。');
    }
    if(!signal.aborted){setState(s=>({...s,queue:s.queue.filter(q=>q.body.requestId!==head.body.requestId),paused:job.status==='submission_unknown'}));setMessage(job.status==='submission_unknown'?'提交结果不确定，已暂停后续生成。请先在 ai& 控制台核对，避免重复扣费。':job.status==='failed'?`本镜头生成失败：${job.error||'请调整后重试。'}`:'本镜头已处理完成。');}
   }catch(e){if(e.name!=='AbortError'&&mounted.current){setState(s=>({...s,paused:true}));updateGeneration(head.index,'running','连接中断：'+e.message+'。可继续查询或停止后续生成。');setMessage('连接中断：'+e.message+'。点击“继续查询 / 处理”，会复用原任务编号。');}}
  }
  run();return()=>{controller.abort();if(activeRequest.current===controller)activeRequest.current=null;};
 },[ready,head?.body.requestId,state.paused]);
 useEffect(()=>{
  if(!ready)return;
  const controller=new AbortController();let timer;
  async function recover(){
   for(const [index,saved] of Object.entries(stateRef.current.jobs)){
    if(controller.signal.aborted)break;
    if(!saved.id||terminal(saved)||stateRef.current.queue.some(q=>q.index===Number(index)))continue;
    try{
     const response=await fetch(`/api/videos/${encodeURIComponent(saved.id)}`,{signal:controller.signal});const remote=await response.json();
     if(response.status===404){setState(s=>s.jobs[index]?.id!==saved.id?s:({...s,jobs:{...s.jobs,[index]:{...s.jobs[index],status:'failed',error:'本地任务记录不存在。已保留编号与路径，请检查原电脑的 .local/videos 文件。'}}}));continue;}
     if(!response.ok)continue;
     setState(s=>s.jobs[index]?.id!==saved.id?s:({...s,jobs:{...s.jobs,[index]:{...s.jobs[index],...remote,revision:saved.revision,aspect:saved.aspect,audioKey:saved.audioKey,referenceKey:saved.referenceKey}}}));
    }catch(e){if(e.name==='AbortError')break;}
   }
   if(!controller.signal.aborted)timer=setTimeout(recover,15000);
  }
  recover();return()=>{controller.abort();clearTimeout(timer);};
 },[ready]);
 useEffect(()=>{
  if(!ready)return;
  if(!state.queue.length){setGeneration(null);return;}
  setGeneration(g=>g||({rows:state.queue.map((q,n)=>({index:q.index,label:shots[q.index].shot_id||`镜头 ${q.index+1}`,status:n===0?'running':'waiting',detail:n===0?labels[state.jobs[q.index]?.status]||labels.submitting:undefined}))}));
 },[ready,state.queue.length]);
 function running(i){const j=state.jobs[i];return j?.id&&!terminal(j);}
 const busy=state.queue.length>0;
 function edit(index,values){setState(s=>({...s,drafts:s.drafts.map((d,i)=>i===index?{...d,...values,revision:crypto.randomUUID()}:d)}));}
 const sources=useMemo(()=>characterSources(data,characterImages),[data,characterImages]);
 const plans=useMemo(()=>state.drafts.map((d,i)=>referencePlan(d.prompt,data.project.characters,sources,currentVoice(voiceData,i),d.image)),[state.drafts,data,sources,voiceData]);
 function voiceFor(i){return currentVoice(voiceData,i);}
 function valid(i){const d=state.drafts[i];return imagesReady&&d.prompt.trim()&&d.prompt.length<=6000&&d.firstPrompt.length<=800&&Number.isInteger(d.seconds)&&d.seconds>=4&&d.seconds<=15&&!plans[i].problems.length;}
 function stale(i){const job=state.jobs[i],d=state.drafts[i];return job&&(job.previous||job.revision!==d.revision||job.aspect!==state.aspect||job.referenceKey!==plans[i].key);}
 function enqueue(indices){
  if(busy||repairing!==null||!config?.accepted)return;
  const queue=indices.map(i=>{const d=state.drafts[i],clip=voiceFor(i),plan=plans[i];return {index:i,revision:d.revision,audioKey:clip.url||null,body:{requestId:crypto.randomUUID(),prompt:d.prompt,firstPrompt:d.firstPrompt,seconds:d.seconds,aspect:state.aspect,characters:plan.matched.map(c=>({name:c.name,image:sources[c.index].image})),image:d.image||undefined,audio:clip.dataUrl,referenceKey:plan.key}};});
  if(!queue.length)return;
  setConfirmAll(false);setGeneration({rows:indices.map(i=>({index:i,label:shots[i].shot_id||`镜头 ${i+1}`,status:'waiting'}))});
  setState(s=>({...s,queue,paused:false}));setMessage(`已加入 ${queue.length} 个镜头，依次生成。`);
 }
 async function upload(i,event){const file=event.target.files[0];event.target.value='';if(!file)return;setUploading(true);try{const image=await readImage(file);if(mounted.current)edit(i,{image});}catch(e){setMessage(e.message);}finally{if(mounted.current)setUploading(false);}}
 async function repairAudio(i,url){setRepairing(i);try{const id=url.split('/')[3];const res=await fetch(`/api/videos/${encodeURIComponent(id)}/restore-narration`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio:voiceFor(i).dataUrl})});const result=await res.json();if(!res.ok)throw new Error(result.error);setState(s=>{const old=s.jobs[i];return {...s,jobs:{...s.jobs,[i]:old.url?{...old,...result}: {...old,previous:{...old.previous,...result}}}};});setMessage('已使用当前配音修复最终音轨，画面未重新生成，不产生视频生成费用。');}catch(e){setMessage(e.message);}finally{if(mounted.current)setRepairing(null);}}
 const pending=state.drafts.flatMap((d,i)=>valid(i)&&!running(i)&&(!state.jobs[i]?.url||stale(i))?[i]:[]);
 const eligible=state.drafts.flatMap((d,i)=>valid(i)&&!running(i)?[i]:[]);
 const generated=Object.entries(state.jobs).flatMap(([i,j])=>{const done=j.url?j:j.previous;return done?.url?[[i,done]]:[];});
 const price=config?.pricing?.find(p=>p.resolution==='768p');
 async function zip(){setPacking(true);try{await downloadZip(generated.map(([i,j])=>({name:(shots[i].shot_id||'shot-'+(Number(i)+1))+'.mp4',url:j.url})),'director-videos.zip',setMessage);}catch(e){setMessage(e.message);}finally{if(mounted.current)setPacking(false);}}
 return <div hidden={!visible} className="video-studio">{playlist&&<MediaPlaylist items={playlist} type="video" onClose={()=>setPlaylist(null)}/>}{visible&&playbackTarget&&createPortal(<div className="studio-playback-row"><button type="button" className="small-button" disabled={!ready||busy||!generated.length} onClick={()=>{players.current.forEach(v=>v?.pause());setPlaylist(generatedPlaylist(shots,state,'video'));}}>{t("▶ 播放全部生成的动画")}</button></div>,playbackTarget)}{confirmAll&&<Modal title={t("如何生成全部动画？")} onCancel={()=>setConfirmAll(false)} footer={<button className="small-button" onClick={()=>setConfirmAll(false)}>{t("取消")}</button>}><p className="generation-note">{t("请选择本次生成方式。旧动画会保留至新版本生成成功。")}</p><div className="generation-choices"><button className="generation-choice" disabled={!pending.length} onClick={()=>enqueue(pending)}><strong>{t("继续生成")}</strong><span>{t("保留以往内容，生成未完成或已修改的 ")}{pending.length}{t(" 条镜头。")}</span></button><button className="generation-choice" disabled={!eligible.length} onClick={()=>enqueue(eligible)}><strong>{t("从头重新生成")}</strong><span>{t("重新生成全部 ")}{eligible.length}{t(" 条可生成镜头，将产生新的生成费用。")}{t(price?`预计 ${(eligible.reduce((sum,i)=>sum+state.drafts[i].seconds,0)*Number(price.per_second)).toFixed(2)} ${price.currency}。`:'')}</span></button></div></Modal>}{generation&&<GenerationDialog title={t("动画生成中")} rows={generation.rows} video paused={state.paused} onResume={()=>setState(s=>({...s,paused:false}))} onStop={stopGeneration}/>}<div className="tts-toolbar"><div><h3>{t("动画工作台")}</h3><p>{t("MiniMax H3 · 配音优先 · 人物自动匹配 · 768p")}</p></div><div className="speech-actions"><select aria-label={t("动画画幅")} value={state.aspect} disabled={busy||!ready} onChange={e=>setState(s=>({...s,aspect:e.target.value}))}>{['Auto','21:9','16:9','4:3','1:1','3:4','9:16'].map(a=><option key={a} value={a}>{t(a)}</option>)}</select><button className="small-button save-image" disabled={busy||repairing!==null||!ready||!config?.accepted||!eligible.length||uploading} onClick={()=>setConfirmAll(true)}>{t(busy?'正在生成动画…':'生成全部动画')}</button><button className="small-button" disabled={!generated.length||packing} onClick={zip}>{t(packing?'正在打包…':'下载已生成动画（ZIP）')}</button></div></div><p className="tts-note">{t(price?`当前报价 ${price.per_second} ${price.currency} / 秒；待生成 ${pending.length} 条，预计 ${(pending.reduce((sum,i)=>sum+state.drafts[i].seconds,0)*Number(price.per_second)).toFixed(2)} ${price.currency}。`:'正在读取账户视频报价。')}{t(" 仅为配音与所需人物图片齐全的镜头生成。提交后无法取消；已完成且未修改的镜头会跳过。")}{t(generated.some(([i])=>stale(Number(i)))?' ZIP 同时包含仍保留的旧版本动画。':'')}</p>{config&&!config.accepted&&<p className="tts-error" role="alert">{t("请先在 ai& 控制台 Playground 接受视频服务条款，然后")}<button className="small-button" onClick={loadConfig}>{t("重新检查权限")}</button>。</p>}<p className="speech-status" role="status">{t(busy?`批量任务剩余 ${state.queue.length} 条。 `:'')}{t(message)}</p>{state.paused&&busy&&<button className="small-button" onClick={()=>setState(s=>({...s,paused:false}))}>{t("继续查询 / 处理")}</button>}<input className="shot-search" type="search" placeholder={t("搜索镜头、人物或提示词…")} aria-label={t("搜索分镜")} value={search} onChange={e=>setSearch(e.target.value)}/>{shots.map((shot,i)=>{
  const d=state.drafts[i],job=state.jobs[i],plan=plans[i],videoUrl=job?.url||job?.previous?.url;if(search&&!JSON.stringify([shot.shot_id,d.prompt,d.firstPrompt]).toLowerCase().includes(search.toLowerCase()))return null;
  return <article className="project-article" key={i}><div className="dialogue-heading"><h3>{t(shot.shot_id||`镜头 ${i+1}`)} <small>{shot.timestamp}</small></h3><div className="speech-actions"><select aria-label={t(`${shot.shot_id||i}动画时长`)} disabled={busy||!ready} value={d.seconds} onChange={e=>edit(i,{seconds:Number(e.target.value)})}>{Array.from({length:12},(_,n)=>n+4).map(n=><option key={n} value={n}>{n}{t(" 秒")}</option>)}</select><button className="small-button" disabled={busy||repairing!==null||!ready||!valid(i)||running(i)||!config?.accepted||uploading} onClick={()=>enqueue([i])}>{t(job?.url?'重新生成动画':'生成动画')}</button></div></div><div className="storyboard-layout"><div><label className="voice-label" htmlFor={`video-prompt-${i}`}>{t("分镜提示词 ")}<span>{d.prompt.length} / 6,000</span></label><textarea id={`video-prompt-${i}`} className="voice-textarea video-prompt" maxLength={6000} disabled={busy||!ready} value={d.prompt} onChange={e=>edit(i,{prompt:e.target.value})}/><label className="voice-label" htmlFor={`first-prompt-${i}`}>{t("首帧提示词 ")}<span>{d.firstPrompt.length} / 800</span></label><textarea id={`first-prompt-${i}`} className="voice-textarea" maxLength={800} disabled={busy||!ready} value={d.firstPrompt} onChange={e=>edit(i,{firstPrompt:e.target.value})}/>{d.firstPrompt.length>800&&<p className="tts-error">{t("请将首帧提示词缩短至 800 字以内。")}</p>}<div className="video-reference"><label className="small-button upload-button">{t(uploading?'正在读取…':d.image?'更换场景参考图':'上传场景参考图（可选）')}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={t(`上传${shot.shot_id||i}场景参考图`)} disabled={busy||!ready||uploading} onChange={e=>upload(i,e)}/></label>{d.image&&<><img src={d.image} alt={t(`${shot.shot_id||i}首帧参考`)}/><button className="small-button" disabled={busy} onClick={()=>edit(i,{image:'',useAudio:false})}>{t("移除图片")}</button></>}</div><div className="reference-summary"><strong>{t("本次生成参考")}</strong><p>{t(voiceFor(i)?.dataUrl?'✓ 当前镜头配音已就绪（主要参考）':'○ 请先生成当前镜头配音')}</p><p>{t("人物：")}{t(plan.matched.length?plan.matched.map(c=>c.name).join('、'):'未在分镜提示词中识别到人物')}</p><div className="matched-characters">{plan.matched.map(c=><div key={c.index}>{sources[c.index]?.image?<img src={sources[c.index].image} alt={t(`${c.name} 自动匹配参考图`)}/>:<span>{t("缺少图片")}</span>}<small>{c.name}</small></div>)}</div>{plan.problems.map((problem,n)=><p key={n} className="tts-error">{t(problem)}</p>)}</div><details className="project-detail"><summary>{t("生成时使用的有效提示词（图片优先）")}</summary><pre>{compileVideoPrompt({prompt:d.prompt,firstPrompt:d.firstPrompt,characters:plan.matched.map(c=>({name:c.name})),image:d.image})}</pre></details><p className="image-hint">{t("先使用已生成的配音，再附上提示词中人物的已保存图片。无人物镜头需上传场景参考图；画面、口型和动作节奏以配音为主。")}</p></div><div className="video-preview-column"><div className="video-preview">{videoUrl?<video controls onError={()=>setMessage('动画路径暂不可用，请检查原电脑的 .local/videos 文件；导入不会自动重新生成。')} preload="metadata" ref={v=>players.current[i]=v} src={`${videoUrl}?audio=${encodeURIComponent(job.audioPolicy||job.previous?.audioPolicy||'provider')}`}/>:<div><span>▶</span><p>{t(job?labels[job.status]||'正在处理视频任务':'生成后的动画将在这里展示')}</p><small>768p · MP4 + AUDIO</small></div>}</div>{job&&<><p className="speech-status" role="status">{t(labels[job.status]||'正在处理视频任务')}{job.cost?` · ${job.cost} ${job.currency}`:''}</p>{job.error&&<p className="tts-error" role="alert">{t(job.error)}</p>}{job.pollError&&<p className="tts-error">{t("查询暂时失败，将继续查询：")}{t(job.pollError)}</p>}{job.downloadError&&<p className="tts-error">{t(job.downloadError)}</p>}{stale(i)&&<p className="tts-error">{t("提示词、素材或设置已修改，当前为上次生成结果。")}</p>}{videoUrl&&<><p className="image-hint">{t(job.audioLocked||job.previous?.audioLocked?'✓ 最终音轨已锁定原始配音':'此旧动画尚未锁定原始配音')}</p><button className="small-button" disabled={busy||repairing!==null||!voiceFor(i)?.dataUrl} onClick={()=>repairAudio(i,videoUrl)}>{t(repairing===i?'正在修复音轨…':'使用当前配音修复音轨（免费）')}</button></>}{job.inputManifest&&<details className="project-detail"><summary>{t("实际提交的素材记录")}</summary><pre>{JSON.stringify(job.inputManifest,null,2)}</pre></details>}{videoUrl&&<a className="small-button" href={videoUrl} download={`${shot.shot_id||'shot-'+i}.mp4`}>{t("下载 MP4")}</a>}</>}</div></div></article>;
 })}{!shots.length&&<p>{t("当前项目没有分镜。")}</p>}</div>;
}
