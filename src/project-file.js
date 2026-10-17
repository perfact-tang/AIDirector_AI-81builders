import {dialogue} from './speech.js';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function mediaSource(value,type){
 const url=typeof value==='string'?value:value?.dataUrl??value?.data_url??value?.url;
 if(typeof url!=='string')return '';
 if(type==='video')return /^\/api\/videos\/[-\w]{16,80}\/content$/.test(url)?url:'';
 if(type==='audio')return /^data:audio\/(mpeg|mp3|wav|x-wav);base64,[A-Za-z0-9+/=]+$/.test(url)||/^\/api\/audio\/[a-f0-9]{64}\.mp3$/.test(url)?url:'';
 return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)?url:'';
}
export const shotsOf=data=>data.project.storyboard.flatMap(s=>s.mvinfo);
export function restoreVoice(data){
 const shots=shotsOf(data),saved=data.director_workspace?.voice;
 const texts=shots.map((s,i)=>typeof saved?.texts?.[i]==='string'?saved.texts[i]:dialogue(s.audio_plan?.audio_text??s.lyrics));
 const clips={};
 shots.forEach((s,i)=>{const clip=saved?.clips?.[i]??s.generated_assets?.voice_audio;const url=mediaSource(clip,'audio');if(url)clips[i]={text:typeof clip.text==='string'?clip.text:texts[i].trim(),voice:typeof clip.voice==='string'?clip.voice:typeof saved?.voice==='string'?saved.voice:'zh-CN-XiaoxiaoNeural',url:mediaSource(clip.url,'audio')||undefined,dataUrl:url.startsWith('data:')?url:undefined};});
 return {texts,clips,voice:typeof saved?.voice==='string'?saved.voice:'zh-CN-XiaoxiaoNeural'};
}
export function restoreVideo(data){
 const saved=data.director_workspace?.video,shots=shotsOf(data);
 const drafts=shots.map((s,i)=>{const d=saved?.drafts?.[i];return {prompt:typeof d?.prompt==='string'?d.prompt:s.video_prompt||'',firstPrompt:typeof d?.firstPrompt==='string'?d.firstPrompt:s.image_prompt||'',seconds:Number.isInteger(d?.seconds)?d.seconds:s.generation_plan?.duration_seconds||s.audio_plan?.duration_seconds||5,image:mediaSource(d?.image,'image'),useAudio:d?.useAudio===true,revision:typeof d?.revision==='string'?d.revision:'initial'};});
 const aspect=saved?.aspect||data.project.director_plan?.aspect_ratio||'16:9',jobs={};
 shots.forEach((s,i)=>{
  const j=saved?.jobs?.[i];const url=mediaSource(j?.url??s.generated_assets?.video,'video');
  if(object(j)||url){const source=object(j)?j:{};const safe={};for(const field of ['id','upstreamId','status','revision','aspect','audioKey','referenceKey','pipelineVersion','audioPolicy','error','pollError','downloadError','cost','currency'])if(typeof source[field]==='string')safe[field]=source[field];if(Number.isFinite(source.createdAt))safe.createdAt=source.createdAt;if(source.audioLocked===true)safe.audioLocked=true;if(source.submittedRequest&&typeof source.submittedRequest==='object')safe.submittedRequest=source.submittedRequest;if(source.inputManifest&&typeof source.inputManifest==='object')safe.inputManifest=source.inputManifest;if(Number.isFinite(source.audioDuration))safe.audioDuration=source.audioDuration;if(Array.isArray(source.referenceNames))safe.referenceNames=source.referenceNames.filter(v=>typeof v==='string');const previousUrl=mediaSource(j?.previous?.url,'video');jobs[i]={...safe,id:/^[-\w]{16,80}$/.test(safe.id||'')?safe.id:undefined,url:url||undefined,previous:previousUrl?{url:previousUrl,status:'completed',audioLocked:j.previous.audioLocked===true,audioPolicy:typeof j.previous.audioPolicy==='string'?j.previous.audioPolicy:undefined,revision:typeof j.previous.revision==='string'?j.previous.revision:'previous',aspect:typeof j.previous.aspect==='string'?j.previous.aspect:aspect}:undefined,status:safe.status||(url?'completed':'failed'),revision:safe.revision??drafts[i].revision,aspect:safe.aspect??aspect,audioKey:safe.audioKey??null};}
 });
 // Imported files never restore submission queues. Existing task IDs can only be queried.
 return {drafts,jobs,aspect,queue:[],paused:false};
}
export function parseProjectFile(input){
 let root=typeof input==='string'?JSON.parse(input.replace(/^\uFEFF/,'')):input;
 if(!object(root))throw new Error('JSON 必须是项目对象。');
 if(!root.project)root={schema:'mv-maker-project',schema_version:4,project:root};
 const p=root.project;
 if(!object(p)||typeof p.direction_name!=='string'||!Array.isArray(p.characters)||!Array.isArray(p.storyboard))throw new Error('项目缺少 direction_name、characters 或 storyboard。');
 if(!p.characters.every(c=>object(c)&&typeof c.name==='string'&&(c.description==null||typeof c.description==='string')&&(c.role==null||typeof c.role==='string'))||!p.storyboard.every(s=>object(s)&&Array.isArray(s.mvinfo)&&s.mvinfo.every(v=>object(v)&&['video_prompt','image_prompt','lyrics','shot_id','timestamp'].every(k=>v[k]==null||typeof v[k]==='string')&&(v.audio_plan?.audio_text==null||typeof v.audio_plan.audio_text==='string'))))throw new Error('人物或分镜数据格式无效。');
 if(p.director_plan!=null&&(!object(p.director_plan)||['style_name','aspect_ratio'].some(k=>p.director_plan[k]!=null&&typeof p.director_plan[k]!=='string')||(p.director_plan.total_duration_seconds!=null&&!['string','number'].includes(typeof p.director_plan.total_duration_seconds))))throw new Error('导演计划格式无效。');
 if(p.characters.length>200||shotsOf(root).length>2000)throw new Error('项目过大：最多支持 200 位人物、2,000 个镜头。');
 const { _localId, ...safeRoot }=root;
 const normalized={...safeRoot,project:{...p,characters:p.characters.map(c=>({...c,description:c.description||''}))}};
 if(root.director_workspace!=null&&!object(root.director_workspace))throw new Error('项目工作区记录格式无效。');
 normalized.director_workspace={version:1,...root.director_workspace,voice:restoreVoice(normalized),video:restoreVideo(normalized)};
 return normalized;
}
export function snapshotProject(data,{images={},voice,video}){
 const {_localId,...root}=data;const p=data.project;let index=0;
 const result={...root,project:{...p,characters:p.characters.map((c,i)=>images[i]?{...c,generated_assets:{...c.generated_assets,image:{data_url:images[i]}}}:c),storyboard:p.storyboard.map(segment=>({...segment,mvinfo:segment.mvinfo.map(s=>{
  const i=index++,text=voice?.texts[i],clip=voice?.clips[i],draft=video?.drafts[i],job=video?.jobs[i];
  const assets={...s.generated_assets};
  if(text!==undefined&&(clip||text!==dialogue(s.audio_plan?.audio_text??s.lyrics))){assets.voice_audio=clip&&clip.text===text.trim()&&clip.voice===voice.voice?{data_url:clip.dataUrl,url:clip.url,voice:clip.voice,text:clip.text,local_file:clip.url?.match(/^\/api\/audio\/([a-f0-9]{64})\.mp3$/)?'.local/audio/'+clip.url.split('/').pop():undefined}:null;assets.drive_audio=null;}
  if(job?.url||job?.previous?.url)assets.video={url:job.url||job.previous.url,task_id:job.id,upstream_id:job.upstreamId,local_file:'.local/videos/'+(job.url||job.previous.url).split('/')[3]+'.mp4'};
  return {...s,...(text!==undefined?{lyrics:text,audio_plan:{...s.audio_plan,audio_text:text}}:{}),video_prompt:draft?.prompt??s.video_prompt,image_prompt:draft?.firstPrompt??s.image_prompt,generation_plan:{...s.generation_plan,...(draft?{duration_seconds:draft.seconds}:{})},generated_assets:assets};
 })}))},director_workspace:{version:1,asset_roots:{videos:'.local/videos/',audio:'.local/audio/'},saved_at:new Date().toISOString(),voice:voice||restoreVoice(data),video:{...(video||restoreVideo(data)),jobs:{...(video||restoreVideo(data)).jobs},queue:[],paused:false},pending_video_tasks:video?.queue?.map(q=>({id:q.body.requestId,index:q.index,revision:q.revision,aspect:q.body.aspect,audioKey:q.audioKey,referenceKey:q.body.referenceKey}))||[]}};
 // Preserve in-flight IDs for read-only recovery, never the queued POST bodies.
 for(const task of result.director_workspace.pending_video_tasks){const old=result.director_workspace.video.jobs[task.index];if(old?.id!==task.id)result.director_workspace.video.jobs[task.index]={...task,status:'submitting',previous:old?.url?{...old,previous:undefined}:old?.previous};}
 return result;
}
