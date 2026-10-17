import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROJECT_ROOT,SKILL_NAME,SKILL_FILES} from '../server/skill-paths.js';
export async function installSkills({root=PROJECT_ROOT,check=false}={}){
 const source=path.join(root,'skills',SKILL_NAME),destination=path.join(root,'.local/skills',SKILL_NAME);
 const files=await Promise.all(SKILL_FILES.map(async name=>({name,bytes:await readFile(path.join(source,name))})));
 for(const {name,bytes} of files){
  const target=path.join(destination,name);
  if(check){if(!(await readFile(target)).equals(bytes))throw new Error(`Installed skill differs from the bundled copy: ${name}. Run npm run skills:install.`);}
  else{await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
 }
 return {destination,count:files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const check=process.argv.includes('--check');
 installSkills({check}).then(({count})=>console.log(`${check?'Verified':'Installed'} ${SKILL_NAME} (${count} files) in .local/skills/${SKILL_NAME}`)).catch(error=>{console.error(`Skill ${check?'verification':'installation'} failed: ${error.message}`);process.exitCode=1;});
}
