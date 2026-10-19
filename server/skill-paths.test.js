import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {installSkills} from '../scripts/install-skills.mjs';
import {PROJECT_ROOT,SKILL_NAME,SKILL_FILES,resolveSkillPath,loadSkillContext} from './skill-paths.js';
test('a fresh clone installs all Skill files locally and loads context without a personal home directory',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'director-skill-'));
 try{
  await mkdir(path.join(root,'skills'),{recursive:true});await cp(path.join(PROJECT_ROOT,'skills',SKILL_NAME),path.join(root,'skills',SKILL_NAME),{recursive:true});
  assert.equal(resolveSkillPath({root,override:''}),path.join(root,'skills',SKILL_NAME));
  const installed=await installSkills({root});assert.equal(installed.count,SKILL_FILES.length);assert.equal(resolveSkillPath({root,override:''}),installed.destination);
  assert.equal((await installSkills({root,check:true})).count,SKILL_FILES.length);
  const context=await loadSkillContext(installed.destination);for(const heading of ['### SKILL.md','### references/app-contract.md','### assets/app-project-template.json'])assert.ok(context.includes(heading));
  assert.ok(!context.includes('/Users/'));
  await writeFile(path.join(installed.destination,'references/examples.md'),'modified local copy');await assert.rejects(installSkills({root,check:true}),/differs/);
  await installSkills({root});assert.equal((await installSkills({root,check:true})).count,SKILL_FILES.length);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Skill override resolves from project root and missing files have setup instructions',async()=>{
 assert.equal(resolveSkillPath({root:'/project',override:'custom/skill'}),path.resolve('/project/custom/skill'));
 assert.equal(resolveSkillPath({root:'/project',override:'/custom/skill'}),path.resolve('/custom/skill'));
 await assert.rejects(loadSkillContext(path.join(tmpdir(),'missing-skill-'+Date.now())),/npm run skills:install/);
});
