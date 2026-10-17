function videoEvent(video,name,signal){
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{video.removeEventListener(name,done);video.removeEventListener('error',error);signal.removeEventListener('abort',abort);};
  const done=()=>{cleanup();resolve();},error=()=>{cleanup();reject(new Error('无法读取上一镜头视频，请检查动画文件。'));},abort=()=>{cleanup();reject(signal.reason||new DOMException('Aborted','AbortError'));};
  video.addEventListener(name,done,{once:true});video.addEventListener('error',error,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
// Browser-only: decode a local MP4, seek inside its final frame, then capture it with Canvas.
export async function extractLastFrame(url,{signal}={}){
 const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(()=>controller.abort(new Error('提取尾帧超时，请检查视频后重试。')),45000),active=controller.signal;
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';let objectUrl;
 try{
  const response=await fetch(url,{signal:active});if(!response.ok)throw new Error('无法读取上一镜头视频，请检查动画文件。');
  objectUrl=URL.createObjectURL(await response.blob());video.src=objectUrl;
  if(video.readyState<1)await videoEvent(video,'loadedmetadata',active);
  if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('上一镜头视频时长无效，无法提取尾帧。');
  const end=Math.max(0,video.duration-Math.min(0.001,video.duration/1000));
  const sought=videoEvent(video,'seeked',active);video.currentTime=end;await sought;
  if(video.readyState<2)await videoEvent(video,'loadeddata',active);
  active.throwIfAborted();
  if(!video.videoWidth||!video.videoHeight)throw new Error('上一镜头没有可用的视频画面。');
  const scale=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('当前浏览器无法提取视频尾帧。');
  context.drawImage(video,0,0,canvas.width,canvas.height);const image=canvas.toDataURL('image/jpeg',0.92);active.throwIfAborted();
  if(!image.startsWith('data:image/jpeg;base64,'))throw new Error('当前浏览器无法提取视频尾帧。');
  return {image,frameTime:video.currentTime,sourceDuration:video.duration,width:canvas.width,height:canvas.height};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);video.pause();video.removeAttribute('src');video.load();if(objectUrl)URL.revokeObjectURL(objectUrl);}
}
