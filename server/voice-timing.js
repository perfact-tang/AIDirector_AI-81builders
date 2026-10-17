import {randomUUID} from 'node:crypto';
import {rename,rm} from 'node:fs/promises';
import {mediaTool,decodedAudioDuration} from './media-tools.js';
export const VOICE_TIMING_VERSION='tempo-fit-v1';
export const validTarget=seconds=>Number.isInteger(seconds)&&seconds>=4&&seconds<=15;
export function tempoFilter(speed){
 if(!Number.isFinite(speed)||speed<1)throw new Error('无效的配音加速倍数。');
 // Keep every atempo stage <= 2 to avoid the filter's high-speed sample skipping mode.
 const count=Math.max(1,Math.ceil(Math.log2(speed))),factor=Math.pow(speed,1/count);
 return Array.from({length:count},()=>`atempo=${factor.toFixed(12)}`).join(',');
}
export async function fitVoice(source,output,targetDuration,{signal}={}){
 if(!validTarget(targetDuration))throw new Error('配音目标时长必须为 4–15 秒的整数。');
 const originalDuration=await decodedAudioDuration(source,{signal});
 const timing={originalDuration,duration:originalDuration,targetDuration,speed:1,durationChecked:true,timingVersion:VOICE_TIMING_VERSION};
 if(originalDuration<=targetDuration)return {...timing,adjusted:false};
 const temporary=output+'.'+randomUUID(),stretched=temporary+'.wav',encoded=temporary+'.mp3';
 let speed=originalDuration/targetDuration;
 try{
  let measured;
  // atempo has a small windowing error. Re-measure before padding, never trim speech to make it fit.
  for(let attempt=0;attempt<5;attempt++){
   await mediaTool(process.env.FFMPEG_BIN||'ffmpeg',['-y','-v','error','-i',source,'-map','0:a:0','-vn','-af',tempoFilter(speed),'-ar','48000','-ac','1','-c:a','pcm_s16le',stretched],120000,{signal});
   measured=await decodedAudioDuration(stretched,{signal});
   if(measured<=targetDuration)break;
   speed*=measured/targetDuration*1.002;
  }
  if(measured>targetDuration)throw new Error('配音加速后仍超时，请缩短台词后重试。');
  await mediaTool(process.env.FFMPEG_BIN||'ffmpeg',['-y','-v','error','-i',stretched,'-af',`apad=whole_dur=${targetDuration},atrim=duration=${targetDuration}`,'-ar','48000','-ac','1','-c:a','libmp3lame','-b:a','192k','-write_xing','1',encoded],120000,{signal});
  const duration=await decodedAudioDuration(encoded,{signal});
  if(Math.abs(duration-targetDuration)>1/48000)throw new Error('配音时长校验失败，请重试。');
  signal?.throwIfAborted();await rename(encoded,output);
  return {...timing,duration,speed,adjusted:true};
 }finally{await Promise.all([rm(stretched,{force:true}),rm(encoded,{force:true})]);}
}
