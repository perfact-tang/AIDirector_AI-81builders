import {createTaskQueue,taskRouter,linkVideoProject} from './tasks.js';
import express from 'express';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {videoRouter,createVideoService} from './videos.js';
import {ttsRouter} from './tts.js';
import {generateProject,briefText,MODEL} from './director.js';
import {authRouter,requireUser,sameOrigin} from './auth.js';
import {cloudEnabled,firebaseServices,publicFirebaseConfig} from './firebase.js';
import {createCloudStore,ownerKey} from './cloud-store.js';
import {projectsRouter,saveProject} from './projects.js';
export function createApp(generate=generateProject,{videos,tts,cloud=cloudEnabled(),firebase=cloud?firebaseServices():null,webConfig=cloud?publicFirebaseConfig():{},taskQueue,taskVerifier}={}){
 const app=express(),jobs=new Map(),services=new Map(),instanceId=randomUUID(),activeScripts=new Map();
 const queue=cloud?(taskQueue||createTaskQueue()):null;
 const storeFor=uid=>createCloudStore(firebase.bucket,uid);
 const userServices=uid=>{if(!services.has(uid)){const store=storeFor(uid),videoService=createVideoService(undefined,path.join(tmpdir(),'director',ownerKey(uid),'videos'),{store});services.set(uid,{videoService,videos:videoRouter(videoService,{onSubmit:async job=>{await linkVideoProject(store,job);if(!['failed','canceled','submission_unknown'].includes(job.status)&&!job.url)await queue.enqueue({kind:'video',uid,id:job.id,attempt:0},30);}}),tts:ttsRouter(undefined,{store})});}return services.get(uid);};
 if(cloud)app.use('/internal',taskRouter({queue,getStore:storeFor,getVideo:uid=>userServices(uid).videoService,runScript,verifier:taskVerifier}));
 app.disable('x-powered-by');app.set('trust proxy',1);
 app.use('/api',(req,res,next)=>{if(req.method==='POST'&&!sameOrigin(req))return res.status(403).json({error:'不允许跨站请求。'});next();});
 app.get('/api/health',(_req,res)=>res.json({status:'ok',model:MODEL,cloud}));
 app.use('/api/auth',authRouter({auth:firebase?.auth,enabled:cloud,config:webConfig}));
 if(cloud){
  app.use('/api',requireUser(firebase.auth));
  app.get('/api/auth/me',(req,res)=>res.json({user:{uid:req.user.uid,email:req.user.email||''}}));
 }
 const getStore=req=>createCloudStore(firebase.bucket,req.user.uid);
 app.use('/api/videos',express.json({limit:cloud?'24mb':'150mb'}));
 app.use('/api/projects',express.json({limit:'24mb'}));
 app.use(express.json({limit:'100kb'}));
 if(cloud){
  app.use('/api/projects',projectsRouter(getStore));
  app.use('/api',(req,res,next)=>{
   userServices(req.user.uid).tts(req,res,next);
  });
  app.use('/api/videos',(req,res,next)=>userServices(req.user.uid).videos(req,res,next));
 }else{app.use('/api',ttsRouter(tts));app.use('/api/videos',videoRouter(videos));}
 app.post('/api/scripts',async(req,res)=>{
  const {style,pace,content}=req.body??{};
  if(!['realistic-3d','anime','2.5d'].includes(style)||![5,10].includes(pace)||typeof content!=='string'||!content.trim()||content.length>12000)return res.status(400).json({error:'请选择画风、节奏，并输入 1–12,000 字的内容。'});
  const owner=cloud?req.user.uid:'local',store=cloud?getStore(req):null;
  if([...jobs.values()].some(j=>j.owner===owner&&j.status==='running'))return res.status(409).json({error:'已有任务正在生成，请等待完成。'});
  const brief={style,pace,content:content.trim()},job={id:randomUUID(),owner,instanceId,status:'running',stage:'正在读取本地 skill',createdAt:Date.now(),brief,prompt:briefText(brief),model:MODEL,events:[{stage:'正在读取本地 skill',at:Date.now()}]};
  for(const [key,j]of jobs)if(j.status!=='running'&&Date.now()-j.createdAt>3600000)jobs.delete(key);
  jobs.set(owner+':'+job.id,job);
  if(store){
   await store.write('scripts/'+job.id+'.json',job);
   try{await queue.enqueue({kind:'script',uid:owner,id:job.id,attempt:0});}catch(e){Object.assign(job,{status:'failed',error:'无法调度方案生成，请稍后重试。'});await store.write('scripts/'+job.id+'.json',job);return res.status(503).json({error:job.error});}
   res.status(202).json(job);
  }else{res.status(202).json(job);executeScript(job,null).catch(()=>{});}
 });
 async function executeScript(job,store){
  let pending=Promise.resolve();
  const persist=()=>{if(store){const snapshot=structuredClone(job);pending=pending.catch(()=>{}).then(()=>store.write('scripts/'+job.id+'.json',snapshot));}return pending;};
  const record=stage=>{if(job.stage!==stage){job.stage=stage;job.events.push({stage,at:Date.now()});persist().catch(()=>{});}};
  try{const project=await generate(job.brief,record);if(store){project._cloudId=job.id;await saveProject(store,project,job.id);}record('生成完成');Object.assign(job,{status:'completed',project});await persist();}
  catch(e){record('生成失败');Object.assign(job,{status:'failed',error:e.message});await persist();}
 }
 async function runScript(uid,id){
  const key=uid+':'+id;if(activeScripts.has(key))return activeScripts.get(key);
  const work=(async()=>{const store=storeFor(uid),job=await store.read('scripts/'+id+'.json');if(!job||job.status!=='running')return;
   try{await store.write('scripts/'+id+'.claim.json',{instanceId,startedAt:Date.now()},{create:true});}
   catch(e){if(e.code!==412)throw e;Object.assign(job,{status:'failed',error:'方案生成请求已中断，未自动重复调用付费模型，请手动重新提交。'});await store.write('scripts/'+id+'.json',job);return;}
   jobs.set(key,job);await executeScript(job,store);
  })();activeScripts.set(key,work);try{await work;}finally{activeScripts.delete(key);}
 }

 app.get('/api/scripts/:id',async(req,res)=>{
  if(!/^[\w-]{16,80}$/.test(req.params.id))return res.sendStatus(404);
  const owner=cloud?req.user.uid:'local',store=cloud?getStore(req):null;
  const job=store?await store.read('scripts/'+req.params.id+'.json'):jobs.get(owner+':'+req.params.id);
  if(!job)return res.status(404).json({error:'任务不存在或服务已重启，请从云端项目列表继续。'});
  if(store&&job.status==='completed'){const {loadProject}=await import('./projects.js');const saved=await loadProject(store,job.id);if(saved)job.project=saved;}
  res.json(job);
 });
 app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在。'}));
 app.use((err,_req,res,_next)=>{console.error('API error',err.code||err.name);res.status(err.status||500).json({error:err.status===413?'内容过长，请减小图片大小或拆分项目。':'请求处理失败。'});});
 return app;
}
export const app=createApp();
