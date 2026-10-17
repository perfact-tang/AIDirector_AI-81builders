import express from 'express';
import {videoRouter} from './videos.js';
import {ttsRouter} from './tts.js';
import { randomUUID } from 'node:crypto';
import { generateProject, briefText, MODEL } from './director.js';
export function createApp(generate = generateProject, {videos,tts} = {}) {
 const app = express(), jobs = new Map();
 app.use('/api/videos',express.json({limit:'150mb'}));
 app.use(express.json({limit:'100kb'}));
 // Requests are same-origin only; prevent websites from triggering paid local jobs.
 app.use('/api', (req,res,next) => {
  if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({error:'不允许跨站请求。'});
  next();
 });
 app.use('/api',ttsRouter(tts));
 app.use('/api/videos',videoRouter(videos));
 app.get('/api/health', (_req,res)=>res.json({status:'ok',model:MODEL,cliConfigured:!!process.env.AIAND_API_KEY}));
 app.post('/api/scripts',(req,res)=>{
  const {style,pace,content}=req.body??{};
  if (!['realistic-3d','anime','2.5d'].includes(style)||![5,10].includes(pace)||typeof content!=='string'||!content.trim()||content.length>12000) return res.status(400).json({error:'请选择画风、节奏，并输入 1–12,000 字的内容。'});
  if ([...jobs.values()].some(j=>j.status==='running')) return res.status(409).json({error:'已有任务正在生成，请等待完成。'});
  const brief={style,pace,content:content.trim()}, job={id:randomUUID(),status:'running',stage:'正在读取本地 skill',createdAt:Date.now(),prompt:briefText(brief),model:MODEL,events:[{stage:'正在读取本地 skill',at:Date.now()}]};
  for (const [id,j] of jobs) if(j.status!=='running' && Date.now()-j.createdAt>3600000) jobs.delete(id);
  jobs.set(job.id,job); res.status(202).json(job);
  const record = stage => { if(job.stage !== stage) { job.stage=stage; job.events.push({stage,at:Date.now()}); } };
  Promise.resolve().then(()=>generate(brief,record)).then(project=>{ record('生成完成'); Object.assign(job,{status:'completed',project}); }).catch(e=>{ record('生成失败'); Object.assign(job,{status:'failed',error:e.message}); });
 });
 app.get('/api/scripts/:id',(req,res)=>{ const job=jobs.get(req.params.id); return job ? res.json(job) : res.status(404).json({error:'任务不存在或服务已重启，请重新生成。'}); });
 app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.status===413?'内容过长。':'请求处理失败。'}));
 return app;
}
export const app=createApp();
