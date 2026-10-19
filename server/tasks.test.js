import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTaskQueue} from './tasks.js';
import {createApp} from './app.js';
import {fakeBucket} from './test-support/fake-bucket.js';
const fixture=JSON.parse(await readFile(new URL('../skills/direct-h3-storyboards/assets/app-project-template.json',import.meta.url)));
test('Cloud Tasks binds an OIDC worker identity and deterministic deduplication name',async()=>{
 const calls=[],client={queuePath:(p,r,q)=>`${p}/${r}/${q}`,createTask:async request=>calls.push(request)};
 const q=createTaskQueue({client,project:'test',region:'tokyo',queue:'queue',url:'https://worker.example',account:'worker@example'}),body={kind:'script',uid:'alice',id:'test-script-123456',attempt:0};
 await q.enqueue(body);await q.enqueue(body);
 assert.equal(calls[0].task.name,calls[1].task.name);assert.equal(calls[0].task.httpRequest.oidcToken.audience,'https://worker.example');assert.equal(calls[0].task.httpRequest.oidcToken.serviceAccountEmail,'worker@example');assert.deepEqual(JSON.parse(Buffer.from(calls[0].task.httpRequest.body,'base64')),body);assert.equal(calls[0].task.dispatchDeadline.seconds,1800);
});
test('script creation only queues work; authenticated worker holds request, persists outcome, and never repeats a paid generation',async()=>{
 const old=process.env.TASK_SERVICE_ACCOUNT;process.env.TASK_SERVICE_ACCOUNT='worker@example';const tasks=[],bucket=fakeBucket();let generates=0;
 const auth={verifySessionCookie:async()=>({uid:'alice'})},taskVerifier={async verifyIdToken({idToken}){if(idToken!=='worker-token')throw new Error('bad');return {getPayload:()=>({email:'worker@example',email_verified:true})};}};
 const app=createApp(async()=>{generates++;return structuredClone(fixture);},{cloud:true,firebase:{auth,bucket},webConfig:{},taskQueue:{enqueue:async body=>tasks.push(body)},taskVerifier});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const response=await fetch(base+'/api/scripts',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'__session=alice'},body:JSON.stringify({style:'anime',pace:5,content:'测试'})});assert.equal(response.status,202);const job=await response.json();assert.equal(generates,0);assert.equal(tasks.length,1);
  const work=token=>fetch(base+'/internal/tasks',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(tasks[0])});
  assert.equal((await work('bad')).status,401);assert.equal(generates,0);
  assert.equal((await work('worker-token')).status,204);assert.equal(generates,1);
  assert.equal((await work('worker-token')).status,204);assert.equal(generates,1);
  const result=await(await fetch(base+'/api/scripts/'+job.id,{headers:{Cookie:'__session=alice'}})).json();assert.equal(result.status,'completed');assert.equal(result.project._cloudId,job.id);
 }finally{await new Promise(r=>server.close(r));if(old===undefined)delete process.env.TASK_SERVICE_ACCOUNT;else process.env.TASK_SERVICE_ACCOUNT=old;}
});
