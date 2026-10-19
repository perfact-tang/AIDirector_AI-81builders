import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCloudStore} from './cloud-store.js';
import {saveProject,loadProject} from './projects.js';
import {createVideoService} from './videos.js';
import {createApp} from './app.js';
import {fakeBucket} from './test-support/fake-bucket.js';
const fixture=JSON.parse(await readFile(new URL('../skills/direct-h3-storyboards/assets/app-project-template.json',import.meta.url)));
const image='data:image/png;base64,aGk=';
test('Storage project and character images survive reload and are isolated by Firebase uid',async()=>{
 const bucket=fakeBucket(),alice=createCloudStore(bucket,'alice'),bob=createCloudStore(bucket,'bob'),id='project-test-123456';
 const data=structuredClone(fixture);data.project.characters[0].generated_assets={image:{data_url:image}};
 await saveProject(alice,data,id);const raw=await alice.read(`projects/${id}.json`);assert.ok(raw.project.characters[0].generated_assets.image.storage_path.startsWith(alice.prefix));assert.equal(raw.project.characters[0].generated_assets.image.data_url,undefined);
 const loaded=await loadProject(createCloudStore(bucket,'alice'),id);assert.equal(loaded.project.characters[0].generated_assets.image.data_url,image);assert.equal(await loadProject(bob,id),null);
 assert.deepEqual(await bob.list('projects/'),[]);await assert.rejects(alice.read('../other'),/Invalid object path/);
});
test('Cloud video completion survives losing all local files without generating again',async()=>{
 const bucket=fakeBucket(),store=createCloudStore(bucket,'alice'),folder=await mkdtemp(path.join(tmpdir(),'cloud-video-'));let creates=0;
 const request=async(route,options={})=>route==='files'?Response.json({id:'file_test'}):route==='videos'?(creates++,Response.json({id:'video_cloudtest',status:'queued'})):route.endsWith('/content')?new Response('fixture-mp4'):Response.json({status:'completed'});
 const options={store,audioInspector:async()=>2,preflight:async()=>{},muxer:async(raw,audio,out)=>{await copyFile(raw,out);return {audioLocked:true};}};
 try{
  const input={requestId:'cloud-video-123456',prompt:'人物行动',firstPrompt:'场景',seconds:5,aspect:'16:9',characters:[{name:'角色',image}],audio:'data:audio/mpeg;base64,aGk=',referenceKey:'ref'};
  await createVideoService(request,folder,options).submit(input);await rm(folder,{recursive:true,force:true});
  const fresh=createVideoService(request,folder,options),done=await fresh.get(input.requestId);assert.equal(done.status,'completed');assert.ok(done.url);assert.equal(creates,1);
  await rm(folder,{recursive:true,force:true});const playback=await createVideoService(request,folder,options).content(input.requestId);assert.equal(await readFile(playback,'utf8'),'fixture-mp4');await rm(path.dirname(playback),{recursive:true,force:true});
  assert.equal((await store.read(`videos/${input.requestId}.json`)).url,done.url);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('Firebase session APIs reject unsigned clients, CSRF, revoked sessions and cross-user project access',async()=>{
 const bucket=fakeBucket();
 const auth={async verifySessionCookie(cookie,checkRevoked){assert.equal(checkRevoked,true);if(cookie==='alice'||cookie==='bob')return {uid:cookie};throw new Error('invalid');},async verifyIdToken(token,checkRevoked){assert.equal(checkRevoked,true);if(token!=='valid')throw new Error('invalid');return {uid:'alice',auth_time:Date.now()/1000};},async createSessionCookie(){return 'alice';}};
 const app=createApp(undefined,{cloud:true,firebase:{bucket,auth},webConfig:{projectId:'test'}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const url of ['/api/projects','/api/tts/voices','/api/videos/config','/api/scripts/1234567890123456'])assert.equal((await fetch(base+url)).status,401);
  const csrfRes=await fetch(base+'/api/auth/csrf'),{token}=await csrfRes.json(),cookie=csrfRes.headers.get('set-cookie').split(';')[0];
  const post=body=>fetch(base+'/api/auth/session',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base},body:JSON.stringify(body)});
  assert.equal((await post({idToken:'valid',csrfToken:'bad'})).status,403);const login=await post({idToken:'valid',csrfToken:token});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  const id='test-project-123456';await saveProject(createCloudStore(bucket,'alice'),fixture,id);
  assert.equal((await fetch(base+'/api/projects/'+id,{headers:{Cookie:'__session=alice'}})).status,200);
  assert.equal((await fetch(base+'/api/projects/'+id,{headers:{Cookie:'__session=bob'}})).status,404);
  assert.equal((await fetch(base+'/api/projects',{headers:{Cookie:'__session=revoked'}})).status,401);
  assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:'https://attacker.test',Cookie:'__session=alice'}})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
