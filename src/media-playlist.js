// Build in storyboard order, including the last usable result during regeneration.
export function generatedPlaylist(shots,state,type){
 return shots.flatMap((shot,index)=>{
  const asset=type==='audio'?state.clips[index]:state.jobs[index]?.url?state.jobs[index]:state.jobs[index]?.previous;
  const source=type==='audio'?asset?.dataUrl||asset?.url:asset?.url;
  if(!source)return [];
  return [{id:index,label:shot.shot_id||`镜头 ${index+1}`,src:type==='video'?`${source}${source.includes('?')?'&':'?'}audio=${encodeURIComponent(asset.audioPolicy||'provider')}`:source,detail:type==='audio'?asset.text||'已生成配音':shot.timestamp||'已生成动画'}];
 });
}
