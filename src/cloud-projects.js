import {browserOwner} from './browser-owner.js';
const savedImages=new Map();
export async function apiJSON(url,options={}){
 const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});const data=await response.json();if(!response.ok){if(response.status===401)location.assign('/');throw new Error(data.error||'请求失败。');}return data;
}
export async function cloudSave(input){
 const data=structuredClone(input),id=data._cloudId;
 // Upload images separately to stay below Cloud Run's HTTP request limit.
 for(const character of data.project.characters){const asset=character.generated_assets?.image;const image=typeof asset==='string'?asset:asset?.data_url??asset?.dataUrl;
  if(image){const cacheKey=JSON.stringify([browserOwner(),id,character.character_id]),cached=savedImages.get(cacheKey);if(cached?.image===image){character.generated_assets={...character.generated_assets,image:cached.saved};continue;}if(typeof asset==='object'&&asset.storage_path){character.generated_assets={...character.generated_assets,image:{storage_path:asset.storage_path}};continue;}const saved=await apiJSON(`/api/projects/${id}/images/${character.character_id}`,{method:'POST',body:JSON.stringify({image})});character.generated_assets={...character.generated_assets,image:saved};savedImages.set(cacheKey,{image,saved});}
 }
 // Preserve embedded narration for imported projects: their old /api/audio URLs
 // may point to another machine or another Firebase user. Native cloud narration
 // also keeps its authenticated URL for playback and recovery.
 return apiJSON('/api/projects/'+id,{method:'POST',body:JSON.stringify(data)});
}
