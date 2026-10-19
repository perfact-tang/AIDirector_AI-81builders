import {fingerprint,referencePlan} from './video-references.js';
export const PENDING_FRAME='data:image/jpeg;base64,AA=='; // Validation placeholder; never submitted.
export function previousVideo(jobs,index){
 if(index<1)return null;
 const job=jobs[index-1];if(job?.status!=='completed'||!job.url)return null;
 return {url:job.url,key:fingerprint(JSON.stringify([job.id||'',job.url,job.revision||'',job.aspect||''])),index:index-1};
}
export function continuityImage(draft,jobs,index){
 if(!draft.usePreviousFrame)return draft.image||'';
 const source=previousVideo(jobs,index);
 return source&&draft.previousFrame?.sourceKey===source.key?draft.previousFrame.image:'';
}
export function selectVideoShots(drafts,jobs,{valid,stale=()=>false,pendingOnly=false}){
 const selected=[];
 for(let i=0;i<drafts.length;i++){
  const job=jobs[i],active=job?.id&&!(['failed','canceled','submission_unknown'].includes(job.status)||(job.status==='completed'&&job.url));
  const chained=drafts[i].usePreviousFrame&&selected.includes(i-1);
  if(active||!valid(i)||drafts[i].usePreviousFrame&&!previousVideo(jobs,i)&&!chained)continue;
  if(!pendingOnly||!job?.url||stale(i)||chained)selected.push(i);
 }
 return selected;
}
export async function prepareContinuityRequest(entry,{jobs,characters,sources,extractFrame,signal}){
 // A prepared body is durable and must stay identical when retrying the same paid request ID.
 if(!entry.usePreviousFrame||entry.prepared)return entry;
 signal?.throwIfAborted();const source=previousVideo(jobs,entry.index);
 if(!source)throw new Error('上一镜头尚未生成成功，已暂停当前及后续生成。请先完成上一镜头。');
 const frame=await extractFrame(source.url,{signal});signal?.throwIfAborted();
 const plan=referencePlan(entry.body.prompt,characters,sources,{dataUrl:entry.body.audio},frame.image,entry.body.characterRefs);
 if(plan.problems.length)throw new Error(plan.problems.join(' '));
 const previousFrame={...frame,sourceUrl:source.url,sourceKey:source.key,sourceIndex:source.index};
 const {image,...continuity}=previousFrame;
 return {...entry,prepared:true,previousFrame,body:{...entry.body,image,referenceKey:plan.key,continuity}};
}
export function applyPreparedReference(state,prepared){
 return {...state,drafts:state.drafts.map((d,i)=>i===prepared.index?{...d,previousFrame:prepared.previousFrame}:d),queue:state.queue.map(q=>q.body.requestId===prepared.body.requestId?prepared:q)};
}
