import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compileVideoPrompt} from '../src/compiled-video-prompt.js';
import {mediaTool,lockNarration} from './media-tools.js';
test('compiler drops conflicting legacy appearance sections and keeps scene action',()=>{
 const raw='subject_definitions:\n<Subject 1> 是艾可，银白渐变青蓝短发，白青机能外套。\n\nretention_analysis:\n<Picture 1> 保留青绿眼睛。\n\ndetailed_description:\n[Shot 1] 艾可在笔记本屏幕内推手。她的动作跟随 <Audio 1>。\n\noverall_soundscape:\n复用主音频\nnon_diegetic_music: N/A';
 const result=compileVideoPrompt({prompt:raw,firstPrompt:'深夜房间，镜头推近。',characters:[{name:'艾可'}]});assert.ok(!result.includes('银白'));assert.ok(!result.includes('青绿'));assert.ok(!result.includes('她的'));assert.match(result,/笔记本屏幕内推手/);assert.match(result,/人物图片是人物身份与外貌的唯一依据/);assert.match(result,/<Picture 1> = 艾可/);assert.match(result,/最终成片将由程序使用原配音混流/);
});
test('final MP4 uses original narration while preserving video packets and provider source',async t=>{
 try{await mediaTool('ffmpeg',['-version']);}catch{t.skip('FFmpeg not installed');return;}
 const folder=await mkdtemp(path.join(tmpdir(),'narration-lock-'));
 try{
  const raw=path.join(folder,'provider.mp4'),voice=path.join(folder,'voice.wav'),out=path.join(folder,'final.mp4');
  await mediaTool('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-f','lavfi','-i','sine=frequency=880:duration=1','-c:v','libx264','-c:a','aac','-shortest',raw]);
  await mediaTool('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.8',voice]);
  const before=await readFile(raw);const result=await lockNarration(raw,voice,out);assert.equal(result.audioLocked,true);assert.deepEqual(await readFile(raw),before);
  const hash=file=>mediaTool('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-c','copy','-f','hash','-hash','sha256','-']);assert.equal(await hash(raw),await hash(out));
  for(const [name,file] of [['source',voice],['result',out]])await mediaTool('ffmpeg',['-y','-v','error','-i',file,'-map','0:a:0','-ar','8000','-ac','1','-f','s16le',path.join(folder,name+'.pcm')]);
  const a=await readFile(path.join(folder,'source.pcm')),b=await readFile(path.join(folder,'result.pcm'));let dot=0,aa=0,bb=0;for(let i=200;i<Math.min(a.length,b.length)-200;i+=2){const x=a.readInt16LE(i),y=b.readInt16LE(i);dot+=x*y;aa+=x*x;bb+=y*y;}assert.ok(dot/Math.sqrt(aa*bb)>0.98,'final audio should correlate with original narration, not provider tone');
 }finally{await rm(folder,{recursive:true,force:true});}
});
