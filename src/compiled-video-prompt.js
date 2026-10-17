// Compile a production scene prompt without replaying stale character-sheet descriptions.
export function compileVideoPrompt(body){
 const original=body.prompt.replace(/\r\n?/g,'\n');
 const section=/^\s*(?:detailed_description|integrated_multimodal_description)\s*[:：]\s*([\s\S]*?)(?=^\s*[a-z][a-z0-9_]*\s*[:：]|$(?![\s\S]))/im.exec(original);
 let scene=(section?.[1]||original).trim();
 // Old subject definitions often contain appearance text conflicting with the uploaded image.
 scene=scene.replace(/(?:^|\n)(?:subject_definitions|retention_analysis|overall_soundscape|non_diegetic_music)\s*[:：][\s\S]*?(?=\n\s*(?:summary|detailed_description|integrated_multimodal_description)\s*[:：]|$)/gi,'');
 for(const line of original.split('\n')){
  const slot=/<Subject\s+(\d+)>/i.exec(line);if(!slot)continue;
  const person=(body.characters||[]).find(c=>line.includes(c.name));if(person)scene=scene.replace(new RegExp(`<Subject\\s+${slot[1]}>`,'gi'),person.name);
 }
 scene=scene.replace(/她的|他的/g,'该角色的');
 const names=[...(body.characters||[]).map(c=>c.name),...(body.image?[body.continuity?'上一镜头尾帧':'场景参考']:[])];
 return `身份优先级：上传的人物图片是人物身份与外貌的唯一依据，包括性别、年龄、发型、发色、五官与服装。不要根据姓名或旧文字自行设计人物。文字与图片冲突时必须以图片为准。多视图设定板表示同一个人物，只提取人物身份，不生成拼贴、三视图、表格、标签或色板。\n${names.map((name,i)=>`<Picture ${i+1}> = ${name}${name==='上一镜头尾帧'?'，这是上一镜头的最后画面，延续场景、光线、机位与动作姿态；人物身份仍以人物参考图片为准':name==='场景参考'?'，仅参考环境构图':'，人物外观严格取自此图片'}。`).join('\n')}\n\n<Audio 1> 是已确定的唯一主配音。动作节奏与表演参考该音频，不另编对白、不替换说话人。最终成片将由程序使用原配音混流。\n\n场景与动作：\n${scene}\n\n构图补充（只采纳空间、机位、光线和动作；不采纳与人物图片冲突的外貌、性别或服装描述）：\n${body.firstPrompt||'按场景设计。'}`;
}
