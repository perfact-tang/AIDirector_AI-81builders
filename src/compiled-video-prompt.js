// Compile a production scene prompt without replaying stale character-sheet descriptions.
export function compileVideoPrompt(body){
 const original=body.prompt.replace(/\r\n?/g,'\n');
 const section=/^\s*(?:detailed_description|integrated_multimodal_description)\s*[:：]\s*([\s\S]*?)(?=^\s*[a-z][a-z0-9_]*\s*[:：]|$(?![\s\S]))/im.exec(original);
 let scene=(section?.[1]||original).trim();
 // Old subject definitions often contain appearance text conflicting with the uploaded image.
 scene=scene.replace(/(?:^|\n)(?:subject_definitions|retention_analysis|overall_soundscape|non_diegetic_music)\s*[:：][\s\S]*?(?=\n\s*(?:summary|detailed_description|integrated_multimodal_description)\s*[:：]|$)/gi,'');
 // Current requests use the explicit reference order; legacy definitions resolve by name.
 const subjects=new Map();
 for(const line of original.split('\n')){
  const slot=/<Subject\s+(\d+)>/i.exec(line);if(!slot)continue;
  const person=(body.characters||[]).find(c=>line.includes(c.name));if(person)subjects.set(+slot[1],person.name);
 }
 scene=scene.replace(/<(Picture|Subject)\s+(\d+)>/gi,(tag,kind,n)=>{
  const person=body.characterRefs?(body.characters||[])[+n-1]:kind.toLowerCase()==='subject'?{name:subjects.get(+n)}:(body.characters||[])[+n-1];
  return person?.name?(body.characterRefs?`<Picture ${n}>（${person.name}）`:person.name):tag;
 });
 scene=scene.replace(/她的|他的/g,'该角色的');
 const hasContinuity=Boolean(body.image&&body.continuity);
 const names=[...(body.characters||[]).map(c=>c.name),...(body.image?[body.continuity?'上一镜头尾帧':'场景参考']:[])];
 const refLines=names.map((name,i)=>{
  if(name==='上一镜头尾帧')return `<Picture ${i+1}> = ${name}，仅作为本镜头 0.00 秒起始衔接参考；镜头开始后必须立刻推进到全新动作、运镜与结束构图，禁止停留在上一帧静止画面或重复上一镜头动作；人物外观仍以人物参考图为准。`;
  if(name==='场景参考')return `<Picture ${i+1}> = ${name}，仅参考环境构图与光影氛围，镜头需有明确动态推进，不静止定格。`;
  return `<Picture ${i+1}> = ${name}，人物外观严格取自此图片（仅锁定人物身份与服装，不限制机位、背景和动作变化）。`;
 }).join('\n');
 const framingHeader=hasContinuity
  ?'本镜头目标构图与画面演进（从起始尾帧过渡到此全新画面状态，避免重复上一帧；不采纳与人物图片冲突的外貌描述）：'
  :'构图补充（独立新镜头，只采纳空间、机位、光线和动作；不采纳与人物图片冲突的外貌、性别或服装描述）：';
 const audioNote=body.audioMode==='music'
  ?'<Audio 1> 是本段音乐 MV 的原曲切片。画面节奏、情绪爆发、运镜切换与表演律动必须紧贴该段音乐节拍与歌词意境，不另编对白或人声。最终成片将由程序保留原曲音频。'
  :'<Audio 1> 是已确定的唯一主配音。动作节奏与表演参考该音频，不另编对白、不替换说话人。最终成片将由程序使用原配音混流。';
 return `身份优先级：上传的人物图片是人物身份与外貌的唯一依据，包括性别、年龄、发型、发色、五官与服装。不要根据姓名或旧文字自行设计人物。文字与图片冲突时必须以图片为准。多视图设定板表示同一个人物，只提取人物身份，不生成拼贴、三视图、表格、标签或色板。\n${refLines}\n\n${audioNote}\n\n场景与动作（必须从第 1 秒到结尾持续演进，禁止静止画面或复读上一镜）：\n${scene}\n\n${framingHeader}\n${body.firstPrompt||'按场景设计。'}`;
}
