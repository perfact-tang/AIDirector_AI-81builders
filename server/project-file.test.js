import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectFile,snapshotProject,restoreVoice,restoreVideo,mediaSource} from '../src/project-file.js';
const video='/api/videos/qa-video-1792208798315/content';
const audio='/api/audio/'+ 'a'.repeat(64)+'.mp3';
function sample(){return {schema:'mv-maker-project',schema_version:4,exported_at:'2026',project:{direction_name:'恢复测试',characters:[{name:'导演',description:'原始人物设定'}],storyboard:[{mvinfo:[{shot_id:'SHOT-001',video_prompt:'原分镜',image_prompt:'原首帧',audio_plan:{audio_text:'原台词'},generation_plan:{duration_seconds:5}}]}]}};}
test('new snapshots round-trip edits, settings, media and task IDs without restoring paid queues',()=>{
 const data=sample(),voice={texts:['修改的台词'],voice:'zh-CN-XiaoxiaoNeural',clips:{0:{text:'修改的台词',voice:'zh-CN-XiaoxiaoNeural',url:audio,dataUrl:'data:audio/mpeg;base64,aGk='}}};
 const state={drafts:[{prompt:'修改的分镜',firstPrompt:'修改的首帧',image:'data:image/png;base64,aGk=',seconds:10,useAudio:true,revision:'changed'}],jobs:{0:{id:'qa-video-1792208798315',upstreamId:'video_remote123',url:video,status:'completed',revision:'changed',aspect:'9:16',audioKey:audio,referenceKey:'voice-first-fingerprint',referenceNames:['导演'],audioDuration:3.38}},aspect:'9:16',queue:[],paused:false};
 const exported=snapshotProject(data,{images:{0:'data:image/png;base64,aGk='},voice,video:state});
 const imported=parseProjectFile(JSON.stringify(exported));
 assert.equal(imported.project.storyboard[0].mvinfo[0].audio_plan.audio_text,'修改的台词');assert.equal(imported.project.storyboard[0].mvinfo[0].generation_plan.duration_seconds,10);
 const restored=restoreVideo(imported);assert.equal(restored.drafts[0].prompt,'修改的分镜');assert.equal(restored.drafts[0].firstPrompt,'修改的首帧');assert.equal(restored.aspect,'9:16');assert.equal(restored.jobs[0].url,video);assert.equal(restored.jobs[0].upstreamId,'video_remote123');assert.equal(restored.jobs[0].referenceKey,'voice-first-fingerprint');assert.deepEqual(restored.jobs[0].referenceNames,['导演']);assert.equal(restored.jobs[0].audioDuration,3.38);assert.deepEqual(restored.queue,[]);assert.equal(restored.drafts[0].useAudio,true);
 assert.equal(restoreVoice(imported).clips[0].dataUrl,'data:audio/mpeg;base64,aGk=');assert.equal(imported.project.characters[0].generated_assets.image.data_url,'data:image/png;base64,aGk=');assert.equal(state.jobs[0].revision,'changed');assert.ok(!JSON.stringify(exported.director_workspace).includes('do not submit'));
});
test('old exported JSON recovers generated video/audio assets and supports standalone project objects',()=>{
 const old=sample();old.project.storyboard[0].mvinfo[0].generated_assets={video:{url:video},voice_audio:{data_url:'data:audio/mpeg;base64,aGk=',url:audio,voice:'zh-CN-XiaoxiaoNeural'}};
 const restored=parseProjectFile(old.project);assert.equal(restoreVideo(restored).jobs[0].url,video);assert.equal(restoreVoice(restored).clips[0].url,audio);assert.deepEqual(restoreVideo(restored).queue,[]);
});
test('invalid documents and unsafe media paths are rejected or ignored',()=>{
 for(const input of ['not json','[]','{}',JSON.stringify({...sample(),project:{...sample().project,storyboard:[{mvinfo:[{video_prompt:{bad:true}}]}]}})])assert.throws(()=>parseProjectFile(input));
 assert.equal(mediaSource('javascript:alert(1)','video'),'');assert.equal(mediaSource('/api/videos/../../secret/content','video'),'');assert.equal(mediaSource('https://unknown.example/video.mp4','video'),'');
 const data=sample();data.director_workspace={video:{queue:[{body:{requestId:'injected'}}],jobs:{0:{status:'completed',url:video,error:{html:'bad'}}}}};const result=parseProjectFile(data);assert.deepEqual(result.director_workspace.video.queue,[]);assert.equal(result.director_workspace.video.jobs[0].error,undefined);
});

test('saving during resubmission preserves new ID and the previous completed media without mutating live state',()=>{
 const data=sample(),old={id:'previous-request-123',url:video,status:'completed',revision:'old'};
 const state={drafts:[{prompt:'new',firstPrompt:'',seconds:5,revision:'new'}],jobs:{0:old},queue:[{index:0,revision:'new',body:{requestId:'unfinished-request-123',prompt:'do not submit',aspect:'16:9'}}],aspect:'16:9'};
 const output=snapshotProject(data,{video:state});const restored=restoreVideo(parseProjectFile(output));assert.equal(restored.jobs[0].id,'unfinished-request-123');assert.equal(restored.jobs[0].previous.url,video);assert.deepEqual(restored.queue,[]);assert.equal(state.jobs[0],old);assert.equal(state.jobs[0].id,'previous-request-123');assert.ok(!JSON.stringify(output.director_workspace).includes('do not submit'));
});

test('voice duration, speed and original source survive project JSON export and re-import',()=>{
 const data=sample(),timing={duration:5,originalDuration:6.4,targetDuration:5,speed:1.28,durationChecked:true,adjusted:true,timingVersion:'tempo-fit-v1',sourceUrl:audio};
 const voice={texts:['原台词'],voice:'zh-CN-XiaoxiaoNeural',clips:{0:{text:'原台词',voice:'zh-CN-XiaoxiaoNeural',dataUrl:'data:audio/mpeg;base64,aGk=',...timing}}};
 const exported=snapshotProject(data,{voice});for(const project of [exported,{project:exported.project}]){
  const clip=restoreVoice(parseProjectFile(project)).clips[0];for(const [key,value]of Object.entries(timing))assert.equal(clip[key],value);
 }
});
