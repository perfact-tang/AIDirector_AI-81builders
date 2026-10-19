// Shared by the app and standalone Skill. IDs are identities; array positions are not.
const clock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
export function normalizeProject(data,{pace}={}) {
 const root=structuredClone(data),p=root.project;
 if(!p||!Array.isArray(p.characters)||!Array.isArray(p.storyboard))throw new Error('缺少人物或分镜数组。');
 const used=new Set(p.characters.map(c=>c.character_id).filter(Boolean));
 p.characters.forEach((c,i)=>{if(!c.character_id){let n=i+1;while(used.has(`CHAR-${String(n).padStart(3,'0')}`))n++;c.character_id=`CHAR-${String(n).padStart(3,'0')}`;used.add(c.character_id);}});
 let time=0,index=0;
 for(const segment of p.storyboard){const start=time;
  for(const shot of segment.mvinfo||[]){index++;shot.shot_id ||= `SHOT-${String(index).padStart(3,'0')}`;
   if(pace){shot.generation_plan={...shot.generation_plan,duration_seconds:pace,frames:pace===5?141:260,audio_mode:'drive-audio'};shot.audio_plan={...shot.audio_plan,duration_seconds:pace};shot.timestamp=`${clock(time)} - ${clock(time+pace)}`;time+=pace;}
  }
  if(pace)segment.movielength=`${clock(start)}-${clock(time)}`;
 }
 if(pace)p.director_plan={...p.director_plan,total_duration_seconds:time,allowed_clip_durations_seconds:[pace]};
 return root;
}
export function validateAppProject(root,{pace}={}){
 const errors=[],p=root?.project;
 if(root?.schema!=='mv-maker-project'||root.schema_version!==4||!p)return ['需要 mv-maker-project v4'];
 if(!p.direction_name?.trim())errors.push('缺少项目名称');
 if(!Array.isArray(p.characters)||!Array.isArray(p.storyboard))return [...errors,'缺少人物或分镜数组'];
 const ids=new Set();
 for(const c of p.characters){if(typeof c.character_id!=='string'||!/^CHAR-[\w-]+$/.test(c.character_id)||ids.has(c.character_id))errors.push('人物 ID 缺失、重复或格式错误');ids.add(c.character_id);if(!c.name?.trim()||!c.description?.trim())errors.push('人物需要姓名和图片提示词');}
 const shots=new Set();let count=0;
 for(const seg of p.storyboard){if(!Array.isArray(seg.mvinfo)){errors.push('段落缺少 mvinfo');continue;}for(const s of seg.mvinfo){count++;
  if(typeof s.shot_id!=='string'||!s.shot_id||shots.has(s.shot_id))errors.push('镜头 ID 缺失或重复');shots.add(s.shot_id);
  const refs=s.character_refs;
  if(!Array.isArray(refs)||refs.some(id=>!ids.has(id))||new Set(refs).size!==refs.length)errors.push(`${s.shot_id}: character_refs 必须引用唯一的有效人物 ID`);
  if((refs?.length||0)>9)errors.push(`${s.shot_id}: 人物参考超过九张`);
  for(const [key,max] of [['video_prompt',6000],['image_prompt',800]])if(typeof s[key]!=='string'||!s[key].trim()||s[key].length>max)errors.push(`${s.shot_id}: ${key} 为空或过长`);
  for(const tag of (s.video_prompt||'').matchAll(/<(?:Picture|Subject)\s+(\d+)>/gi))if(+tag[1]<1||+tag[1]>(refs?.length||0))errors.push(`${s.shot_id}: 参考标注超出 character_refs`);
  if(typeof s.audio_plan?.audio_text!=='string'||!s.audio_plan.audio_text.trim())errors.push(`${s.shot_id}: 当前流程需要可生成的配音文本`);
  if(![5,10].includes(s.generation_plan?.duration_seconds)||(pace&&s.generation_plan.duration_seconds!==pace))errors.push(`${s.shot_id}: 镜头时长必须符合表单`);
  if(s.generation_plan?.audio_mode!=='drive-audio')errors.push(`${s.shot_id}: 必须使用已有配音`);
 }}
 if(!count)errors.push('至少需要一个镜头');return errors;
}
