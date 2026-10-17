import test from 'node:test';
import assert from 'node:assert/strict';
import {previousVideo,continuityImage,selectVideoShots,prepareContinuityRequest,applyPreparedReference} from '../src/video-continuity.js';
const image='data:image/jpeg;base64,aGk=',audio='data:audio/mpeg;base64,aGk=';
const completed=(id='source-video-shot-001')=>({id,status:'completed',url:`/api/videos/${id}/content`,revision:'initial',aspect:'16:9'});
const entry={index:1,usePreviousFrame:true,revision:'draft',body:{requestId:'continuity-shot-002',prompt:'湖边晨光',audio,characters:[],referenceKey:'placeholder'}};
const frame={image,frameTime:4.999,sourceDuration:5,width:1280,height:720};
test('previous-frame sources require the immediately previous completed video and invalidate after regeneration',()=>{
 const jobs={0:completed()};assert.equal(previousVideo(jobs,0),null);assert.equal(previousVideo(jobs,1).url,jobs[0].url);assert.equal(previousVideo(jobs,2),null);
 assert.equal(previousVideo({0:{status:'failed',previous:completed()}},1),null);
 const source=previousVideo(jobs,1),draft={usePreviousFrame:true,image:'manual',previousFrame:{image,sourceKey:source.key}};
 assert.equal(continuityImage(draft,jobs,1),image);assert.equal(continuityImage(draft,{0:completed('regenerated-shot-001')},1),'');assert.equal(continuityImage({...draft,usePreviousFrame:false},jobs,1),'manual');
});
test('batch selection allows future references and cascades regeneration only through enabled links',()=>{
 const drafts=[{}, {usePreviousFrame:true},{usePreviousFrame:true},{}],valid=()=>true;
 assert.deepEqual(selectVideoShots(drafts,{}, {valid}),[0,1,2,3]);
 assert.deepEqual(selectVideoShots(drafts,{}, {valid:i=>i!==0}),[3]);
 const jobs=Object.fromEntries([0,1,2,3].map(i=>[i,completed('completed-shot-00'+i)]));
 assert.deepEqual(selectVideoShots(drafts,jobs,{valid,stale:i=>i===0,pendingOnly:true}),[0,1,2]);
 assert.deepEqual(selectVideoShots(drafts,jobs,{valid,pendingOnly:true}),[]);
 const downloading={0:{id:'downloading-shot-001',status:'completed'}};assert.deepEqual(selectVideoShots(drafts,downloading,{valid}),[3]);
});
test('tail capture is deferred to queue head and prepared retries preserve the same paid request body',async()=>{
 const jobs={0:completed('fresh-generated-shot-001')},calls=[];
 const prepared=await prepareContinuityRequest(entry,{jobs,characters:[],sources:[],extractFrame:async url=>{calls.push(url);return frame;}});
 assert.deepEqual(calls,[jobs[0].url]);assert.equal(prepared.body.image,image);assert.equal(prepared.body.audio,audio);assert.equal(prepared.body.requestId,entry.body.requestId);assert.equal(prepared.body.continuity.sourceUrl,jobs[0].url);assert.notEqual(prepared.body.referenceKey,'placeholder');assert.equal(entry.body.image,undefined);
 const retry=await prepareContinuityRequest(prepared,{jobs:{0:completed('different-source-shot')},extractFrame:()=>{throw new Error('must not capture again');}});assert.equal(retry,prepared);
 const state={drafts:[{revision:'first'},{revision:'draft'}],jobs,queue:[entry,{...entry,index:2,body:{...entry.body,requestId:'continuity-shot-003'}}]};const next=applyPreparedReference(state,prepared);assert.equal(next.drafts[1].previousFrame.image,image);assert.equal(next.drafts[1].revision,'draft');assert.equal(next.queue[0],prepared);assert.equal(next.queue[1],state.queue[1]);assert.equal(state.drafts[1].previousFrame,undefined);
});
test('failed predecessors and aborted frame capture stop preparation before any submission',async()=>{
 let calls=0;await assert.rejects(prepareContinuityRequest(entry,{jobs:{0:{status:'failed',previous:completed()}},extractFrame:()=>{calls++;}}),/上一镜头尚未生成成功/);assert.equal(calls,0);
 const controller=new AbortController();await assert.rejects(prepareContinuityRequest(entry,{jobs:{0:completed()},signal:controller.signal,extractFrame:async()=>{controller.abort();return frame;}}),{name:'AbortError'});
});
