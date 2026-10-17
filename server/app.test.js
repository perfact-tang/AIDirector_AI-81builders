import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { briefText, parseOutput } from './director.js';
test('brief includes visual style, pacing and source material',()=>{const text=briefText({style:'anime',pace:10,content:'雨夜'});assert.match(text,/日本动漫/);assert.match(text,/10 秒/);assert.match(text,/雨夜/);});
test('reject truncated or non-project output',()=>{assert.throws(()=>parseOutput(JSON.stringify({choices:[{finish_reason:'length'}]})),/截断/);assert.throws(()=>parseOutput(JSON.stringify({choices:[{message:{content:'{}'}}]})),/格式/);});
test('async jobs validate requests, expose completion and failure',async()=>{
 const app=createApp(async (b,onStage)=>{onStage('正在调用模型编写导演方案');onStage('正在校验人物、声音与分镜数据');if(b.content==='fail')throw new Error('测试失败');return {schema:'mv-maker-project',schema_version:4,project:{direction_name:'测试'}};});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(base+'/api/scripts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  for(const content of ['', ' ', 'x'.repeat(12001)])assert.equal((await post({style:'anime',pace:5,content})).status,400);
  for(const content of ['story','fail']) {
   const res=await post({style:'anime',pace:5,content});assert.equal(res.status,202);const j=await res.json();await new Promise(r=>setTimeout(r,10));const done=await(await fetch(base+'/api/scripts/'+j.id)).json();assert.equal(done.status,content==='fail'?'failed':'completed');assert.deepEqual(done.events.map(e=>e.stage),['正在读取本地 skill','正在调用模型编写导演方案','正在校验人物、声音与分镜数据',content==='fail'?'生成失败':'生成完成']);assert.ok(done.events.every(e=>Number.isFinite(e.at)));
  }
  const cross=await fetch(base+'/api/scripts',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'});assert.equal(cross.status,403);
 } finally {await new Promise(r=>server.close(r));}
});
test('Vite proxy accepts browser same-origin POST and still rejects cross-site POST', async () => {
 const { createServer } = await import('vite');
 const { default: config } = await import('../vite.config.js');
 const backend = createApp(async () => ({schema:'mv-maker-project',schema_version:4,project:{}})).listen(0,'127.0.0.1');
 await new Promise(resolve => backend.once('listening',resolve));
 let vite;
 try {
  vite = await createServer({
   configFile:false, logLevel:'silent',
   server:{host:'127.0.0.1',port:0, proxy:{'/api':{...config.server.proxy['/api'],target:`http://127.0.0.1:${backend.address().port}`}}},
  });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const request = value => fetch(origin+'/api/scripts', {
   method:'POST',headers:{'Content-Type':'application/json',Origin:value},
   body:JSON.stringify({style:'anime',pace:5,content:'代理回归测试'}),
  });
  assert.equal((await request(origin)).status,202);
  assert.equal((await request('https://other.example')).status,403);
 } finally {
  if(vite) await vite.close();
  await new Promise(resolve => backend.close(resolve));
 }
});
