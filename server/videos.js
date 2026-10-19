import express from 'express';
import {mkdir,readFile,writeFile,rename,stat,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {copyFile} from 'node:fs/promises';
import {compileVideoPrompt} from '../src/compiled-video-prompt.js';
import {lockNarration,mediaTool,decodedAudioDuration} from './media-tools.js';
import {tmpdir} from 'node:os';
const directory=fileURLToPath(new URL('../.local/videos/',import.meta.url));
const MODEL='minimaxai/minimax-h3';
const aspects=['Auto','21:9','16:9','4:3','1:1','3:4','9:16'];
const errors={agreement_required:'请先在 ai& 控制台 Playground 接受视频服务条款。',insufficient_credits:'ai& 余额不足。',monthly_budget_reached:'ai& 月度预算不足。',concurrency_limit_exceeded:'ai& 同时生成数量已达上限，请等待现有任务完成。',rate_limit_exceeded:'ai& 提交过于频繁，请稍后重试。',moderation_blocked:'提示词或参考素材未通过内容审核，请修改后重试。',provider_unavailable:'视频服务暂不可用。',model_not_found:'当前账户无法使用 MiniMax H3。'};
export async function aiRequest(route,options={}){
 if(!process.env.AIAND_API_KEY)throw Object.assign(new Error('后端未配置 AIAND_API_KEY。'),{httpStatus:401});
 const res=await fetch('https://api.aiand.com/v1/'+route,{...options,headers:{Authorization:'Bearer '+process.env.AIAND_API_KEY,...options.headers},signal:AbortSignal.timeout(route.endsWith('/content')?180000:60000)});
 if(!res.ok){let e={};try{e=await res.json();}catch{}const code=e.error?.code||e.code;throw Object.assign(new Error(errors[code]||`ai& 请求失败（${res.status}${code?' / '+code:''}）。`),{httpStatus:res.status});}
 return res;
}
function decodeMedia(value,type){
 const re=type==='image'?/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/:/^data:(audio\/(?:mpeg|mp3|wav|x-wav));base64,([A-Za-z0-9+/=]+)$/;
 const match=typeof value==='string'&&value.match(re);if(!match)throw new Error('参考素材格式无效。');
 const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>(type==='image'?10:15)*1024*1024)throw new Error('参考素材过大或为空。');
 return {bytes,mime:match[1]};
}
export function validateVideo(b){
 if(!b||!/^[-a-zA-Z0-9_]{16,80}$/.test(b.requestId??'')||typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>6000||typeof b.firstPrompt!=='string'||b.firstPrompt.length>800||!Number.isInteger(b.seconds)||b.seconds<4||b.seconds>15||!aspects.includes(b.aspect))throw new Error('请检查提示词、首帧提示词、时长（4–15 秒）与画幅。');
 if(!b.audio)throw new Error('生成动画必须使用当前镜头已生成的配音。');
 decodeMedia(b.audio,'audio');
 if(!Array.isArray(b.characters)||!b.characters.every(c=>c&&typeof c.name==='string'&&c.name.trim()&&c.name.length<=80&&typeof c.image==='string'))throw new Error('人物参考数据无效。');
 if(b.characterRefs!==undefined&&(!Array.isArray(b.characterRefs)||new Set(b.characterRefs).size!==b.characterRefs.length||b.characterRefs.length!==b.characters.length||b.characters.some((c,i)=>c.character_id!==b.characterRefs[i])))throw new Error('人物 ID 与参考图片顺序不一致。');
 if(b.characterRefs)for(const tag of b.prompt.matchAll(/<(Picture|Subject)\s+(\d+)>/gi)){const max=b.characters.length+(tag[1].toLowerCase()==='picture'&&b.image?1:0);if(+tag[2]<1||+tag[2]>max)throw new Error('参考标注超出当前镜头的人物绑定。');}
 for(const c of b.characters)decodeMedia(c.image,'image');
 if(b.image)decodeMedia(b.image,'image');
 if(b.characters.length+(b.image?1:0)<1)throw new Error('音频参考至少需要一张人物或场景图片。');
 if(b.characters.length+(b.image?1:0)>9)throw new Error('参考图片不能超过 9 张。');
 if(typeof b.referenceKey!=='string'||b.referenceKey.length>100)throw new Error('缺少参考素材版本，请刷新后重新提交。');
 if(b.continuity){
  const c=b.continuity;
  if(!b.image||!/^\/api\/videos\/[-\w]{16,80}\/content$/.test(c.sourceUrl||'')||typeof c.sourceKey!=='string'||c.sourceKey.length>100||!Number.isInteger(c.sourceIndex)||c.sourceIndex<0||!Number.isFinite(c.frameTime)||c.frameTime<0||!Number.isFinite(c.sourceDuration)||c.sourceDuration<=0||c.frameTime>c.sourceDuration)throw new Error('尾帧参考记录无效，请重新提取。');
 }
 if(videoPrompt(b).length>7000)throw new Error('提示词和参考说明总长度超过 7,000 字，请缩短提示词。');
}
export const videoPrompt=compileVideoPrompt;
export async function inspectAudio(value){
 const {bytes}=decodeMedia(value,'audio'),folder=await mkdtemp(path.join(tmpdir(),'director-audio-check-')),file=path.join(folder,'voice.mp3');
 try{
  await writeFile(file,bytes);
  return await decodedAudioDuration(file);
 }finally{await rm(folder,{recursive:true,force:true});}
}
export function createVideoService(request=aiRequest,folder=directory,{audioInspector=inspectAudio,muxer=lockNarration,store,preflight=()=>mediaTool(process.env.FFMPEG_BIN||'ffmpeg',['-version'])}={}){
 const locks=new Map();
 async function save(job){if(store)return store.write('videos/'+job.id+'.json',job);await mkdir(folder,{recursive:true});const dest=path.join(folder,job.id+'.json'),tmp=dest+'.tmp';await writeFile(tmp,JSON.stringify(job));await rename(tmp,dest);}
 async function load(id){if(store)return store.read('videos/'+id+'.json');try{return JSON.parse(await readFile(path.join(folder,id+'.json'),'utf8'));}catch{return null;}}
 async function upload(value,type){const {bytes,mime}=decodeMedia(value,type),form=new FormData();form.append('purpose',type==='image'?'vision':'audio');form.append('file',new Blob([bytes],{type:mime}),type==='image'?'reference.'+(mime.endsWith('jpeg')?'jpg':mime.split('/')[1]):'voice.mp3');const result=await(await request('files',{method:'POST',body:form})).json();if(!result.id)throw new Error('ai& 未返回素材 ID。');return result.id;}
 async function submit(body){
  validateVideo(body);const id=body.requestId;
  if(locks.has(id))return locks.get(id);
  const work=(async()=>{
   const existing=await load(id);if(existing)return existing;
   const job={id,status:'submitting',createdAt:Date.now(),seconds:body.seconds,aspect:body.aspect,prompt:body.prompt,firstPrompt:body.firstPrompt,...(typeof body.projectId==='string'?{projectId:body.projectId}:{}),...(typeof body.shotId==='string'?{shotId:body.shotId}:{}),revision:typeof body.revision==='string'?body.revision:'initial'};
   if(store){try{await store.write('videos/'+id+'.json',job,{create:true});}catch(e){if(e.code===412)return load(id);throw e;}}else await save(job);
   await mkdir(folder,{recursive:true});
   let posting=false;
   try{
    const duration=await audioInspector(body.audio);
    if(duration>body.seconds+0.02)throw new Error(`配音长 ${duration.toFixed(2)} 秒，超过镜头 ${body.seconds} 秒。请延长镜头或拆分台词，避免被截断。`);
    await preflight();
    await writeFile(path.join(folder,id+'.narration.mp3'),decodeMedia(body.audio,'audio').bytes);
    job.narrationFile=id+'.narration.mp3';if(store)await store.upload('videos/'+job.narrationFile,path.join(folder,job.narrationFile),'audio/mpeg');job.pipelineVersion='voice-image-v2';
    if(body.continuity)job.continuity={...body.continuity};
    job.audioDuration=duration;job.referenceKey=body.referenceKey;job.referenceNames=body.characters.map(c=>c.name);
    const payload={model:MODEL,prompt:videoPrompt(body),seconds:body.seconds,aspect_ratio:body.aspect};
    const images=[];const manifest=[];
    const hash=value=>createHash('sha256').update(decodeMedia(value,'image').bytes).digest('hex');
    for(const [index,character] of body.characters.entries()){if(store)await store.bytes(`videos/${id}.reference-${index}.image`,decodeMedia(character.image,'image').bytes,decodeMedia(character.image,'image').mime);const file_id=await upload(character.image,'image');images.push({file_id});manifest.push({character_id:character.character_id,name:character.name,file_id,sha256:hash(character.image)});}
    if(body.image){if(store)await store.bytes(`videos/${id}.scene.image`,decodeMedia(body.image,'image').bytes,decodeMedia(body.image,'image').mime);const file_id=await upload(body.image,'image');images.push({file_id});manifest.push({name:body.continuity?'上一镜头尾帧':'场景参考',file_id,sha256:hash(body.image)});}
    payload.references={images,audio:[{file_id:await upload(body.audio,'audio')}]};
    job.submittedRequest=payload;job.inputManifest={images:manifest,...(job.continuity?{continuity:job.continuity}:{}),audio:{file_id:payload.references.audio[0].file_id,sha256:createHash('sha256').update(decodeMedia(body.audio,'audio').bytes).digest('hex')}};
    await save(job);
    posting=true;
    const result=await(await request('videos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
    if(!/^video_[a-zA-Z0-9_-]+$/.test(result.id||''))throw new Error('未返回可用的视频任务 ID。');
    Object.assign(job,{upstreamId:result.id,status:result.status||'queued',cost:result.cost,currency:result.currency,lastPoll:0});
   }catch(e){Object.assign(job,{status:posting&&!e.httpStatus?'submission_unknown':'failed',error:e.message});}
   await save(job);return job;
  })();locks.set(id,work);try{return await work;}finally{locks.delete(id);}
 }
 async function get(id){
  if(locks.has(id))return locks.get(id);
  const work=(async()=>{
   const job=await load(id);if(!job)return null;
   if(job.status==='completed'&&job.url||['failed','canceled','submission_unknown'].includes(job.status))return job;
   if(!job.upstreamId){return {...job,status:'submission_unknown',error:'提交状态待确认，请先在 ai& 控制台检查任务，避免重复扣费。'};}
   if(Date.now()-(job.lastPoll||0)<15000)return job;
   try{
    const remote=await(await request('videos/'+encodeURIComponent(job.upstreamId))).json();
    Object.assign(job,{status:remote.status||job.status,lastPoll:Date.now(),error:remote.error?(errors[remote.error.code]||remote.error.message||'视频生成失败。'):null});
    if(job.status==='completed'){
     const dest=path.join(folder,id+'.mp4'),raw=path.join(folder,id+'.provider.mp4'),tmp=raw+'.part';
     try{
      await mkdir(folder,{recursive:true});
      if(store){try{await store.download('videos/'+id+'.provider.mp4',raw);}catch(e){if(e.code!==404)throw e;}if(job.narrationFile)await store.download('videos/'+job.narrationFile,path.join(folder,job.narrationFile));}
      let available=false;try{available=(await stat(raw)).size>0;}catch{}
      if(!available){const response=await request('videos/'+encodeURIComponent(job.upstreamId)+'/content');await pipeline(Readable.fromWeb(response.body),createWriteStream(tmp));if(!(await stat(tmp)).size)throw new Error('视频文件为空。');await rename(tmp,raw);if(store)await store.upload('videos/'+id+'.provider.mp4',raw,'video/mp4');}
      if(job.narrationFile)Object.assign(job,await muxer(raw,path.join(folder,job.narrationFile),dest));else await copyFile(raw,dest);
      if(store)await store.upload('videos/'+id+'.mp4',dest,'video/mp4');
      job.url=`/api/videos/${id}/content`;job.downloadError=null;
      if(store)await Promise.all([raw,dest,path.join(folder,job.narrationFile||'unused')].map(file=>rm(file,{force:true})));

     }catch(e){await rm(tmp,{force:true});job.downloadError='视频已生成，原配音混流未完成：'+e.message+'。将自动重试，不重新生成视频。';}

    }
    job.pollError=null;await save(job);
   }catch(e){job.pollError=e.message;job.lastPoll=Date.now();await save(job);}
   return job;
  })();locks.set(id,work);try{return await work;}finally{locks.delete(id);}
 }
 async function restoreNarration(id,audio){
  decodeMedia(audio,'audio');
  if(locks.has(id))await locks.get(id);
  const work=(async()=>{
   const job=await load(id);if(!job?.url)throw new Error('此任务尚无本地视频。');
   const raw=path.join(folder,id+'.provider.mp4'),temporary=path.join(folder,id+'.repair-narration.mp3');
   if(store){await mkdir(folder,{recursive:true});await store.download('videos/'+id+'.provider.mp4',raw);}
   try{await stat(raw);}catch{await copyFile(path.join(folder,id+'.mp4'),raw);}
   try{
    await writeFile(temporary,decodeMedia(audio,'audio').bytes);
    const result=await muxer(raw,temporary,path.join(folder,id+'.mp4'));
    await rename(temporary,path.join(folder,id+'.narration.mp3'));
    if(store){await store.upload('videos/'+id+'.mp4',path.join(folder,id+'.mp4'),'video/mp4');await store.upload('videos/'+id+'.narration.mp3',path.join(folder,id+'.narration.mp3'),'audio/mpeg');}
    Object.assign(job,result,{narrationFile:id+'.narration.mp3',audioRepairAt:Date.now()});await save(job);return job;
   }finally{await rm(temporary,{force:true});}
  })();locks.set(id,work);try{return await work;}finally{locks.delete(id);}
 }

 return {submit,get,restoreNarration,folder,async content(id){if(!store)return path.join(folder,id+'.mp4');const directory=await mkdtemp(path.join(tmpdir(),'director-playback-'));try{return await store.download('videos/'+id+'.mp4',path.join(directory,'video.mp4'));}catch(e){await rm(directory,{recursive:true,force:true});throw e;}},cloud:!!store,async config(){const [a,m]=await Promise.all([request('videos/acceptance'),request('videos/models')]);const acceptance=await a.json(),models=await m.json();return {accepted:acceptance.accepted,model:MODEL,pricing:models.data?.find(m=>m.id===MODEL)?.pricing??[]};}};
}
export function videoRouter(service=createVideoService(),{onSubmit}={}){
 const router=express.Router();
 router.get('/config',async(_req,res)=>{try{res.json(await service.config());}catch(e){res.status(502).json({error:e.message});}});
 router.post('/',async(req,res)=>{try{validateVideo(req.body);const job=await service.submit(req.body);if(onSubmit)await onSubmit(job);res.status(202).json(job);}catch(e){res.status(400).json({error:e.message});}});
 router.post('/:id/restore-narration',async(req,res)=>{if(!/^[-a-zA-Z0-9_]{16,80}$/.test(req.params.id))return res.sendStatus(404);try{res.json(await service.restoreNarration(req.params.id,req.body?.audio));}catch(e){res.status(400).json({error:e.message});}});
 const valid=id=>/^[-a-zA-Z0-9_]{16,80}$/.test(id);
 router.get('/:id',async(req,res)=>{if(!valid(req.params.id))return res.status(404).json({error:'任务不存在。'});try{const job=await service.get(req.params.id);job?res.json(job):res.status(404).json({error:'任务不存在。'});}catch{res.status(500).json({error:'无法读取本地视频任务。'});}});
 router.get('/:id/content',async(req,res)=>{if(!valid(req.params.id))return res.sendStatus(404);try{const job=await service.get(req.params.id);if(!job?.url)return res.status(404).json({error:'视频尚未缓存。'});const file=service.content?await service.content(req.params.id):path.join(service.folder,req.params.id+'.mp4');res.type('video/mp4').sendFile(file,{dotfiles:'allow'},e=>{if(service.cloud)rm(path.dirname(file),{recursive:true,force:true}).catch(()=>{});if(e&&!res.headersSent)res.status(404).json({error:'视频文件不存在。'});});}catch{res.sendStatus(500);}});
 return router;
}
