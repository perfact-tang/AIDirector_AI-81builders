import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {ttsRouter} from './tts.js';
test('TTS validates text/voice, returns audio metadata, and reports failures',async()=>{
 const calls=[];const app=express();app.use(express.json());app.use('/api',ttsRouter(async b=>{calls.push(b);if(b.text==='fail')throw new Error('测试连接失败');return {...b,url:'/api/audio/test.mp3'};}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const post=b=>fetch(base+'/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{
  const voices=await(await fetch(base+'/tts/voices')).json();assert.ok(voices.voices.some(v=>v.id==='zh-CN-XiaoxiaoNeural'));
  for(const body of [{},{text:' ',voice:'zh-CN-XiaoxiaoNeural'},{text:'你好',voice:'invalid'},...[0,3,16,5.5,'5',null].map(seconds=>({text:'你好',voice:'zh-CN-XiaoxiaoNeural',seconds})),{text:'x'.repeat(5001),voice:'zh-CN-XiaoxiaoNeural'}])assert.equal((await post(body)).status,400);
  assert.equal(calls.length,0);
  const res=await post({text:' 你好 ',voice:'zh-CN-XiaoxiaoNeural'});assert.equal(res.status,200);assert.equal((await res.json()).text,'你好');assert.equal(calls.length,1);assert.equal(calls[0].seconds,5);
  const timed=await post({text:'按十秒处理',voice:'zh-CN-XiaoxiaoNeural',seconds:10});assert.equal(timed.status,200);assert.equal(calls[1].seconds,10);
  assert.equal((await post({text:'fail',voice:'zh-CN-XiaoxiaoNeural'})).status,502);
  assert.equal((await fetch(base+'/audio/not-valid.mp3')).status,404);
 }finally{await new Promise(r=>server.close(r));}
});
test('TTS limits concurrent synthesis and releases capacity after failure',async()=>{
 let release;const held=new Promise(r=>release=r);const app=express();app.use(express.json());app.use(ttsRouter(async()=>{await held;throw new Error('failed');}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=()=>fetch(`http://127.0.0.1:${server.address().port}/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'hello',voice:'en-US-JennyNeural'})});
 try{const a=request(),b=request();await new Promise(r=>setTimeout(r,25));assert.equal((await request()).status,429);release();assert.equal((await a).status,502);assert.equal((await b).status,502);assert.equal((await request()).status,502);}finally{release();await new Promise(r=>server.close(r));}
});
test('cached MP3 is served from the local audio directory, including range requests',async()=>{
 const {mkdir,writeFile,rm}=await import('node:fs/promises');const {randomBytes}=await import('node:crypto');
 const directory=new URL('../.local/audio/',import.meta.url),name=randomBytes(32).toString('hex')+'.mp3',file=new URL(name,directory);await mkdir(directory,{recursive:true});await writeFile(file,Buffer.from('ID3fixture-audio'));
 const app=express();app.use(ttsRouter());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/audio/${name}`;
 try{const res=await fetch(url);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/audio\/mpeg/);assert.equal(await res.text(),'ID3fixture-audio');const range=await fetch(url,{headers:{Range:'bytes=0-2'}});assert.equal(range.status,206);assert.equal(await range.text(),'ID3');}finally{await new Promise(r=>server.close(r));await rm(file);}
});
test('disconnecting a TTS request aborts synthesis and releases the worker slot',async()=>{
 let started,stopped;const began=new Promise(r=>started=r),ended=new Promise(r=>stopped=r);let active=0;
 const app=express();app.use(express.json());app.use(ttsRouter(async(_body,{signal})=>{
  active++;started();try{await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{stopped();reject(signal.reason);},{once:true});});}finally{active--;}
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const controller=new AbortController();
 try{
  const request=fetch(`http://127.0.0.1:${server.address().port}/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'停止测试',voice:'zh-CN-XiaoxiaoNeural'}),signal:controller.signal});
  const rejected=assert.rejects(request,{name:'AbortError'});await began;assert.equal(active,1);controller.abort();await rejected;
  await Promise.race([ended,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('backend synthesis was not canceled')),1000);timer.unref();})]);
  await new Promise(r=>setImmediate(r));assert.equal(active,0);
 }finally{controller.abort();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
