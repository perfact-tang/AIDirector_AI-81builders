import {spawn} from 'node:child_process';
import {rename,rm} from 'node:fs/promises';
export function mediaTool(command,args,timeout=30000,{signal,onStdout}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',finished=false,failure,killTimer;
  const finish=e=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(stdout);};
  const stop=error=>{failure=error;child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref();};
  const abort=()=>stop(signal.reason||new DOMException('Aborted','AbortError'));
  const timer=setTimeout(()=>stop(new Error('本地音视频处理超时。')),timeout);
  child.stdout.on('data',b=>{if(onStdout)onStdout(b);else stdout+=b;});
  child.stderr.on('data',b=>stderr=(stderr+b).slice(-3000));
  child.on('error',()=>finish(new Error('无法启动 FFmpeg / ffprobe，请检查本机安装与配置。')));
  child.on('close',code=>finish(failure||(code===0?null:new Error('本地音视频处理失败：'+stderr.slice(-500)))));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
// Count decoded samples instead of MP3 packet padding. Used at both generation and video upload.
export async function decodedAudioDuration(file,{signal}={}){
 let bytes=0;
 await mediaTool(process.env.FFMPEG_BIN||'ffmpeg',['-v','error','-i',file,'-map','0:a:0','-vn','-ac','1','-ar','48000','-f','s16le','-'],60000,{signal,onStdout:chunk=>{bytes+=chunk.length;}});
 const duration=bytes/(48000*2);if(!Number.isFinite(duration)||duration<=0)throw new Error('无法识别配音文件，请重新生成配音。');return duration;
}
export async function durationOf(file){const raw=await mediaTool(process.env.FFPROBE_BIN||'ffprobe',['-v','error','-show_entries','format=duration','-of','json',file]);const duration=Number(JSON.parse(raw).format?.duration);if(!Number.isFinite(duration)||duration<=0)throw new Error('无法识别素材时长。');return duration;}
export async function lockNarration(video,audio,output){
 const [videoDuration,audioDuration]=await Promise.all([durationOf(video),decodedAudioDuration(audio)]);
 if(audioDuration>videoDuration+0.02)throw new Error(`原配音 ${audioDuration.toFixed(2)} 秒超过视频 ${videoDuration.toFixed(2)} 秒，无法在不截断台词的情况下修复。`);
 const tmp=output+'.audio-lock.tmp.mp4';
 try{
  await mediaTool(process.env.FFMPEG_BIN||'ffmpeg',['-y','-v','error','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','apad','-t',String(videoDuration),'-movflags','+faststart',tmp],120000);
  await rename(tmp,output);return {audioLocked:true,audioDuration,videoDuration,audioPolicy:'original-narration-v2'};
 }finally{await rm(tmp,{force:true});}
}
