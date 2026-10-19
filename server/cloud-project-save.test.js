import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudSave} from '../src/cloud-projects.js';
test('cloud save preserves portable imported narration even if its old URL is unavailable',async()=>{
 const request=globalThis.fetch;let snapshot;
 globalThis.fetch=async(url,options)=>{snapshot=JSON.parse(options.body);return Response.json({id:'import-project-123456'});};
 try{const clip={url:'/api/audio/'+'a'.repeat(64)+'.mp3',dataUrl:'data:audio/mpeg;base64,aGk='};const data={_cloudId:'import-project-123456',project:{characters:[],storyboard:[{mvinfo:[{generated_assets:{voice_audio:{url:clip.url,data_url:clip.dataUrl}}}]}]},director_workspace:{voice:{clips:{0:clip}}}};await cloudSave(data);assert.equal(snapshot.director_workspace.voice.clips[0].dataUrl,clip.dataUrl);assert.equal(snapshot.project.storyboard[0].mvinfo[0].generated_assets.voice_audio.data_url,clip.dataUrl);assert.equal(data.director_workspace.voice.clips[0].dataUrl,clip.dataUrl);}finally{globalThis.fetch=request;}
});
