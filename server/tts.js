import express from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,stat,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=path.join(root,'.local/audio');
export const VOICES=[
 {id:'zh-CN-XiaoxiaoNeural',name:'晓晓 · 中文女声'}, {id:'zh-CN-YunxiNeural',name:'云希 · 中文男声'},
 {id:'ja-JP-NanamiNeural',name:'Nanami · 日文女声'}, {id:'ja-JP-KeitaNeural',name:'Keita · 日文男声'},
 {id:'en-US-JennyNeural',name:'Jenny · 英文女声'}, {id:'en-US-GuyNeural',name:'Guy · 英文男声'},
 {id:'ko-KR-SunHiNeural',name:'SunHi · 韩文女声'}, {id:'ko-KR-InJoonNeural',name:'InJoon · 韩文男声'},
];
export function validTts(body){return body && typeof body.text==='string' && body.text.trim().length>0 && body.text.length<=5000 && VOICES.some(v=>v.id===body.voice);}
export async function synthesize({text,voice},{signal}={}) {
 signal?.throwIfAborted();
 await mkdir(directory,{recursive:true});
 const id=createHash('sha256').update(JSON.stringify([voice,text.trim()])).digest('hex');
 const output=path.join(directory,id+'.mp3');
 try {if((await stat(output)).size>0)return {url:`/api/audio/${id}.mp3`,voice,text:text.trim()};}catch{}
 const temporary=path.join(directory,`${id}-${randomUUID()}.tmp`);
 try {
  await new Promise((resolve,reject)=>{
   const child=spawn(process.env.EDGE_TTS_PYTHON||path.join(root,'.venv/bin/python'),[path.join(root,'server/edge-tts.py')],{shell:false,stdio:['pipe','ignore','pipe']});
   let finished=false;
   const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
   const cancel=()=>{child.kill('SIGTERM');};
   const timer=setTimeout(()=>{child.kill('SIGTERM');finish(new Error('Edge TTS 生成超时，请稍后重试。'));},90000);
   child.on('error',()=>finish(new Error('Edge TTS 未安装或无法启动，请检查项目 Python 环境。')));
   child.stderr.resume();
   child.on('close',code=>finish(signal?.aborted?new DOMException('已停止配音生成','AbortError'):code===0?null:new Error('Edge TTS 连接失败，请检查网络后重试。')));
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({text:text.trim(),voice,output:temporary}));
  });
  signal?.throwIfAborted();
  if(!(await stat(temporary)).size)throw new Error('Edge TTS 未返回音频。');
  await rename(temporary,output);
  return {url:`/api/audio/${id}.mp3`,voice,text:text.trim()};
 } finally {await rm(temporary,{force:true});}
}
export function ttsRouter(generate=synthesize){
 const router=express.Router();let active=0;
 router.get('/tts/voices',(_req,res)=>res.json({voices:VOICES}));
 router.post('/tts',async(req,res)=>{
  if(!validTts(req.body))return res.status(400).json({error:'请选择支持的音色，并输入 1–5,000 字的台词。'});
  if(active>=2)return res.status(429).json({error:'配音任务繁忙，请稍后重试。'});
  active++;const controller=new AbortController();
  const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
  try {const clip=await generate({text:req.body.text.trim(),voice:req.body.voice},{signal:controller.signal});if(!controller.signal.aborted)res.json(clip);}
  catch(e){if(!controller.signal.aborted&&!res.destroyed)res.status(502).json({error:e.message});}finally{res.off('close',disconnect);active--;}
 });
 router.get('/audio/:file',(req,res,next)=>{
  if(!/^[a-f0-9]{64}\.mp3$/.test(req.params.file))return res.status(404).json({error:'音频不存在。'});
  res.type('audio/mpeg').sendFile(path.join(directory,req.params.file),{dotfiles:'allow'},error=>{if(error&&!res.headersSent)res.status(404).json({error:'音频不存在，请重新生成。'});});
 });
 return router;
}
