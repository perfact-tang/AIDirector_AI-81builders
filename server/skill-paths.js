import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const PROJECT_ROOT=fileURLToPath(new URL('../',import.meta.url));
export const SKILL_NAME='direct-h3-storyboards';
export const SKILL_FILES=[
 'SKILL.md','agents/openai.yaml','assets/storyboard-template.json',
 'references/directing-playbook.md','references/character-reference-sheets.md',
 'references/project-schema.md','references/h3-routing.md','references/examples.md',
 'scripts/validate_storyboard.mjs','scripts/test_validate.mjs',
 'scripts/project_contract.mjs','scripts/validate_app_project.mjs','references/app-contract.md','assets/app-project-template.json',
];
export const CONTEXT_FILES=['SKILL.md','references/app-contract.md','assets/app-project-template.json'];
export function resolveSkillPath({root=PROJECT_ROOT,override=process.env.DIRECTOR_SKILL_PATH}={}){
 if(override)return path.resolve(root,override);
 const installed=path.join(root,'.local/skills',SKILL_NAME);
 return existsSync(path.join(installed,'SKILL.md'))?installed:path.join(root,'skills',SKILL_NAME);
}
export async function loadSkillContext(directory=resolveSkillPath()){
 try{return (await Promise.all(CONTEXT_FILES.map(async file=>`\n### ${file}\n${await readFile(path.join(directory,file),'utf8')}`))).join('\n');}
 catch(error){if(error.code==='ENOENT')throw new Error('导演 Skill 文件缺失，请运行 npm run skills:install，或检查 DIRECTOR_SKILL_PATH。');throw error;}
}
