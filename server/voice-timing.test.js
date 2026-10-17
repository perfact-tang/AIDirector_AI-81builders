import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fitVoice,tempoFilter} from './voice-timing.js';
import {mediaTool,decodedAudioDuration,lockNarration,durationOf} from './media-tools.js';
import {inspectAudio} from './videos.js';
import {synthesize} from './tts.js';
const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
async function fixture(t,callback){
 try{await mediaTool(ffmpeg,['-version']);}catch{t.skip('FFmpeg not installed');return;}
 const folder=await mkdtemp(path.join(tmpdir(),'voice-timing-'));
 try{await callback(folder);}finally{await rm(folder,{recursive:true,force:true});}
}
test('large speed factors use chained atempo stages no greater than 2',()=>{
 for(const speed of [1,1.2,2,2.5,16.3,300]){const factors=tempoFilter(speed).split(',').map(s=>Number(s.slice(7)));assert.ok(factors.every(n=>n>=1&&n<=2));assert.ok(Math.abs(factors.reduce((a,b)=>a*b,1)-speed)<1e-7);}
 for(const value of [NaN,Infinity,0,-1])assert.throws(()=>tempoFilter(value));
});
test('overlong narration fits 5 seconds, retains ending and pitch, and passes upload and final mux checks',async t=>fixture(t,async folder=>{
 const source=path.join(folder,'original.mp3'),out=path.join(folder,'fitted.mp3');
 await mediaTool(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=5','-f','lavfi','-i','sine=frequency=880:duration=1','-filter_complex','[0:a][1:a]concat=n=2:v=0:a=1','-ar','48000','-c:a','libmp3lame',source]);
 const before=await readFile(source),result=await fitVoice(source,out,5);
 assert.equal(result.adjusted,true);assert.ok(Math.abs(result.originalDuration-6)<0.001);assert.ok(result.speed>=1.2&&result.speed<1.25);assert.equal(result.targetDuration,5);assert.equal(result.duration,5);assert.deepEqual(await readFile(source),before);
 const audio='data:audio/mpeg;base64,'+(await readFile(out)).toString('base64');assert.equal(await inspectAudio(audio),5);
 // Container padding conventions vary by encoder; upload must measure decoded samples.
 assert.ok(Math.abs(await durationOf(out)-5)<0.1);assert.equal(await decodedAudioDuration(out),5);
 const tail=path.join(folder,'tail.pcm');await mediaTool(ffmpeg,['-y','-v','error','-ss','4.4','-i',out,'-t','0.4','-ar','8000','-ac','1','-f','s16le',tail]);
 const pcm=await readFile(tail);
 const power=hz=>{let real=0,imag=0;for(let i=0;i<pcm.length/2;i++){const sample=pcm.readInt16LE(i*2);const phase=2*Math.PI*hz*i/8000;real+=sample*Math.cos(phase);imag+=sample*Math.sin(phase);}return real*real+imag*imag;};
 assert.ok(power(880)>power(440)*10,'ending 880 Hz marker must remain, rather than truncating the ending');
 assert.ok(power(880)>power(1056)*10,'tempo adjustment must preserve pitch instead of raising it by 1.2x');
 const video=path.join(folder,'video.mp4'),final=path.join(folder,'final.mp4');await mediaTool(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=black:s=64x64:d=5','-c:v','libx264','-pix_fmt','yuv420p',video]);
 assert.equal((await lockNarration(video,out,final)).audioDuration,5);
}));
test('10-second and high-speed targets are exact; fitting never changes a shorter original',async t=>fixture(t,async folder=>{
 const source=path.join(folder,'long.wav');await mediaTool(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=12.5',source]);
 for(const target of [10,4]){const out=path.join(folder,target+'.mp3');const timing=await fitVoice(source,out,target);assert.equal(timing.duration,target);assert.equal(await decodedAudioDuration(out),target);assert.ok(timing.speed>=12.5/target);}
 const short=path.join(folder,'short.mp3'),unused=path.join(folder,'unused.mp3');await mediaTool(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=duration=2',short]);
 const bytes=await readFile(short),timing=await fitVoice(short,unused,5);assert.equal(timing.adjusted,false);assert.equal(timing.speed,1);assert.equal(timing.duration,2);assert.deepEqual(await readFile(short),bytes);await assert.rejects(stat(unused),{code:'ENOENT'});
 await assert.rejects(fitVoice(short,unused,3),/4–15/);
}));
test('TTS reuses raw synthesis and caches separate fitted results for each target',async t=>fixture(t,async folder=>{
 const text='timing-cache-'+randomUUID(),voice='zh-CN-XiaoxiaoNeural',id=createHash('sha256').update(JSON.stringify([voice,text])).digest('hex');
 const directory=new URL('../.local/audio/',import.meta.url),raw=new URL(id+'.mp3',directory);const cleanup=[raw];
 await mediaTool(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=duration=6','-ar','48000',path.join(folder,'raw.mp3')]);await copyFile(path.join(folder,'raw.mp3'),raw);
 try{
  const fitted=await synthesize({text,voice,seconds:5});assert.equal(fitted.duration,5);assert.equal(fitted.adjusted,true);assert.ok(fitted.sourceUrl.endsWith(id+'.mp3'));assert.notEqual(fitted.url,fitted.sourceUrl);
  const fitName=fitted.url.split('/').pop();cleanup.push(new URL(fitName,directory),new URL(fitName.replace('.mp3','.json'),directory));
  const again=await synthesize({text,voice,seconds:5});assert.deepEqual(again,fitted);
  const longer=await synthesize({text,voice,seconds:10});assert.equal(longer.adjusted,false);assert.equal(longer.url,fitted.sourceUrl);assert.equal(longer.targetDuration,10);
  const longerId=createHash('sha256').update(JSON.stringify(['tempo-fit-v1',fitted.sourceUrl,10])).digest('hex');cleanup.push(new URL(longerId+'.json',directory));
 }finally{await Promise.all(cleanup.map(file=>rm(file,{force:true})));}
}));
test('local audio processing honors cancellation and pre-aborted signals',async()=>{
 const controller=new AbortController();const running=mediaTool(ffmpeg,['-v','error','-re','-f','lavfi','-i','sine=duration=30','-f','null','-'],10000,{signal:controller.signal});const timer=setTimeout(()=>controller.abort(),60);
 try{await assert.rejects(running,{name:'AbortError'});assert.throws(()=>mediaTool(ffmpeg,['-version'],10000,{signal:controller.signal}),{name:'AbortError'});}finally{clearTimeout(timer);}
});
