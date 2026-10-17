// Pure helpers shared by the UI and tests. Fingerprints detect edits, not authenticate media.
export function fingerprint(text=''){let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16)+':'+text.length;}
export function matchCharacters(prompt,characters){
 const text=prompt.normalize('NFKC').toLowerCase(),matches=[];
 characters.forEach((character,index)=>{
  const names=[character.name,...String(character.name||'').split(/[()（）/／|、]/u),...(Array.isArray(character.aliases)?character.aliases:[])].filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim().normalize('NFKC').toLowerCase());
  for(const alias of new Set(names)){let position=0;while((position=text.indexOf(alias,position))!==-1){const end=position+alias.length;const word=c=>!!c&&/[\p{Script=Latin}\p{N}_]/u.test(c);const latin=/^[\p{Script=Latin}\d_ -]+$/u.test(alias);if(!latin||(!word(text[position-1])&&!word(text[end])))matches.push({index,name:character.name,start:position,end});position=end;}}
 });
 matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start||a.index-b.index);
 const accepted=[];for(const m of matches)if(!accepted.some(a=>m.start<a.end&&a.start<m.end))accepted.push(m);
 accepted.sort((a,b)=>a.start-b.start);return accepted.filter((m,i,a)=>a.findIndex(x=>x.index===m.index)===i).map(({index,name})=>({index,name}));
}
export function currentVoice(state,index){const clip=state?.clips[index];return clip&&clip.text===state.texts[index]?.trim()&&clip.voice===state.voice?clip:null;}
export function characterSources(data,images={}){return data.project.characters.map((c,index)=>{const asset=c.generated_assets?.image;const image=images[index]||(typeof asset==='string'?asset:asset?.data_url??asset?.dataUrl??asset?.url)||'';const valid=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image);return {image:valid?image:'',key:valid?fingerprint(image):''};});}
export function referencePlan(prompt,characters,sources,clip,scene=''){
 const matched=matchCharacters(prompt,characters),missing=matched.filter(c=>!sources[c.index]?.image).map(c=>c.name);
 const refs=matched.filter(c=>sources[c.index]?.image).map(c=>({name:c.name,image:sources[c.index].image,key:sources[c.index].key}));
 if(scene)refs.push({name:'场景参考',image:scene,key:fingerprint(scene)});
 const problems=[];
 if(!clip?.dataUrl)problems.push('请先在声音设计中为当前台词生成配音；修改台词或音色后需要重新生成。');
 if(missing.length)problems.push('请在人物展示中上传并保存图片：'+missing.join('、')+'。');
 if(!matched.length&&/<(?:Picture|Subject)\s+\d+>/i.test(prompt))problems.push('提示词中有参考编号但无法匹配人物，请写出人物展示中的姓名。');
 if(!refs.length&&!missing.length)problems.push('此镜头没有可用的人物图片，请上传场景参考图。');
 if(refs.length>9)problems.push('参考图片超过 9 张，请拆分镜头或移除场景参考图。');
 const key=fingerprint(JSON.stringify(['voice-image-v2',clip?.dataUrl?fingerprint(clip.dataUrl):null,refs.map(r=>[r.name,r.key]),missing]));
 return {matched,refs,problems,key};
}
