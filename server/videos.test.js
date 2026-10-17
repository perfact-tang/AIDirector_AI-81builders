import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVideoService,validateVideo,videoPrompt,inspectAudio} from './videos.js';
const image='data:image/png;base64,aGk=',audio='data:audio/mpeg;base64,aGk=';
const input={requestId:'test-video-job-12345',prompt:'小明在树林中说话',firstPrompt:'树林晨光',seconds:5,aspect:'16:9',characters:[{name:'小明',image}],audio,referenceKey:'test-reference-v1'};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const options={audioInspector:async()=>3,preflight:async()=>{},muxer:async(raw,audio,out)=>{await copyFile(raw,out);return {audioLocked:true,audioPolicy:'original-narration-v2'};}};
test('video generation requires narration and an image anchor; prompt prioritizes narration',()=>{
 validateVideo(input);for(const change of [{audio:undefined},{characters:[]},{seconds:20},{prompt:'x'.repeat(6001)},{characters:Array.from({length:10},()=>({name:'小明',image}))}])assert.throws(()=>validateVideo({...input,...change}));
 const text=videoPrompt(input);assert.match(text,/唯一主配音/);assert.match(text,/<Picture 1> = 小明/);assert.match(text,/小明在树林中说话/);assert.match(text,/不另编对白、不替换说话人/);assert.match(text,/唯一依据/);
});
test('video submit is idempotent, polls completion, caches MP4, survives service restart',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'video-test-'));let posts=0,polls=0;
 const request=async(route,options={})=>{if(route==='files')return json({id:'file_'+options.body.get('purpose')});if(route==='videos'){posts++;await new Promise(r=>setTimeout(r,5));const body=JSON.parse(options.body);assert.equal(body.model,'minimaxai/minimax-h3');assert.equal(body.seconds,5);return json({id:'video_mock123',status:'queued',cost:'50',currency:'jpy'});}if(route.endsWith('/content'))return new Response(Buffer.from('mp4-test'));polls++;return json({status:'completed'});};
 try{
  const service=createVideoService(request,folder,options);const [a,b]=await Promise.all([service.submit(input),service.submit(input)]);assert.equal(posts,1);assert.equal(a.id,b.id);assert.equal(a.audioDuration,3);assert.deepEqual(a.referenceNames,['小明']);
  const fresh=createVideoService(request,folder,options);const done=await fresh.get(a.id);assert.equal(done.status,'completed');assert.ok(done.url);assert.equal((await readFile(path.join(folder,a.id+'.mp4'))).toString(),'mp4-test');await fresh.get(a.id);assert.equal(polls,1);await fresh.submit(input);assert.equal(posts,1);
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('all matched character images and narration upload in order using references, never frames',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'video-media-'));const bodies=[],purposes=[];
 const request=async(route,options)=>{if(route==='files'){const purpose=options.body.get('purpose');purposes.push(purpose);return json({id:'file-'+purposes.length});}bodies.push(JSON.parse(options.body));return json({id:'video_media',status:'moderating'});};
 try{const service=createVideoService(request,folder,options);await service.submit({...input,characters:[{name:'小明',image},{name:'小红',image}],image,requestId:'test-image-job-12345'});assert.ok(!bodies[0].image_reference);assert.deepEqual(purposes,['vision','vision','vision','audio']);assert.deepEqual(bodies[0].references,{images:[{file_id:'file-1'},{file_id:'file-2'},{file_id:'file-3'}],audio:[{file_id:'file-4'}]});assert.match(bodies[0].prompt,/<Picture 2> = 小红/);}finally{await rm(folder,{recursive:true,force:true});}
});
test('audio longer than the shot fails before uploading or creating a billed job',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'video-duration-'));let calls=0;
 try{const service=createVideoService(async()=>{calls++;},folder,{audioInspector:async()=>7.25});const job=await service.submit(input);assert.equal(job.status,'failed');assert.match(job.error,/超过镜头 5 秒/);assert.equal(calls,0);}finally{await rm(folder,{recursive:true,force:true});}
});
test('uncertain submit is persisted without automatically resubmitting a paid request',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'video-unknown-'));let posts=0;
 const request=async route=>{if(route==='files')return json({id:'file_mock'});posts++;throw new Error('fetch failed');};
 try{const service=createVideoService(request,folder,options);assert.equal((await service.submit(input)).status,'submission_unknown');await service.submit(input);assert.equal(posts,1);assert.equal((await service.get(input.requestId)).status,'submission_unknown');}finally{await rm(folder,{recursive:true,force:true});}
});
test('last-frame continuity is sent as an image reference while retaining narration and character references',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'video-continuity-')),bodies=[],purposes=[];
 const continuity={sourceUrl:'/api/videos/source-video-shot-001/content',sourceKey:'source-key',sourceIndex:0,frameTime:4.999,sourceDuration:5,width:1280,height:720};
 const request=async(route,opts)=>{if(route==='files'){purposes.push(opts.body.get('purpose'));return json({id:'file-'+purposes.length});}bodies.push(JSON.parse(opts.body));return json({id:'video_continuity',status:'queued'});};
 try{
  const service=createVideoService(request,folder,options),job=await service.submit({...input,image,continuity,requestId:'continuity-job-12345'});
  assert.deepEqual(purposes,['vision','vision','audio']);assert.deepEqual(bodies[0].references,{images:[{file_id:'file-1'},{file_id:'file-2'}],audio:[{file_id:'file-3'}]});assert.match(bodies[0].prompt,/<Picture 2> = 上一镜头尾帧/);assert.match(bodies[0].prompt,/唯一主配音/);assert.equal(job.inputManifest.images[1].name,'上一镜头尾帧');assert.deepEqual(job.inputManifest.continuity,continuity);
  for(const change of [{image:undefined},{continuity:{...continuity,sourceUrl:'https://evil.test/video.mp4'}},{continuity:{...continuity,frameTime:6}}])assert.throws(()=>validateVideo({...input,image,continuity,...change}),/尾帧/);
 }finally{await rm(folder,{recursive:true,force:true});}
});
