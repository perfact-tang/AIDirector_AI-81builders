import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeProject,validateAppProject} from '../src/project-contract.js';
import {referencePlan} from '../src/video-references.js';
import {compileVideoPrompt} from '../src/compiled-video-prompt.js';
import {validateVideo} from './videos.js';
const template=JSON.parse(await readFile(new URL('../skills/direct-h3-storyboards/assets/app-project-template.json',import.meta.url)));
test('app normalizer computes time, duration and frames and preserves identities',()=>{
 const data=structuredClone(template);data.project.storyboard[0].mvinfo.push(structuredClone(data.project.storyboard[0].mvinfo[0]));delete data.project.storyboard[0].mvinfo[1].shot_id;
 const output=normalizeProject(data,{pace:10}),shots=output.project.storyboard[0].mvinfo;
 assert.equal(output.project.director_plan.total_duration_seconds,20);assert.equal(shots[1].timestamp,'00:10 - 00:20');assert.equal(shots[1].generation_plan.frames,260);assert.deepEqual(validateAppProject(output,{pace:10}),[]);
 assert.deepEqual(normalizeProject(output,{pace:10}),output);
 shots[0].character_refs=['CHAR-unknown'];assert.ok(validateAppProject(output).some(e=>e.includes('character_refs')));
 shots[0].character_refs=['CHAR-001'];shots[0].video_prompt='<Subject 2>微笑';assert.ok(validateAppProject(output).some(e=>e.includes('标注')));
});
test('explicit IDs select identical names and pronouns in exact order, even after reorder',()=>{
 const chars=[{character_id:'CHAR-B',name:'小明'},{character_id:'CHAR-A',name:'小明'}],sources=[{image:'B',key:'b'},{image:'A',key:'a'}];
 const plan=referencePlan('他抬头',chars,sources,{dataUrl:'audio'},'', ['CHAR-A','CHAR-B']);
 assert.deepEqual(plan.matched.map(c=>c.index),[1,0]);assert.deepEqual(plan.problems,[]);
 assert.ok(referencePlan('他抬头',chars,sources,{dataUrl:'audio'},'', ['CHAR-missing']).problems.some(p=>p.includes('ID')));
 const text=compileVideoPrompt({prompt:'<Subject 2>转身看向<Subject 1>',characterRefs:['CHAR-A','CHAR-B'],characters:[chars[1],chars[0]]});
 assert.ok(text.includes('<Picture 2>（小明）转身看向<Picture 1>（小明）'));
});
test('server rejects IDs that do not match uploaded reference order',()=>{
 const image='data:image/png;base64,aGk=',body={requestId:'1234567890123456',prompt:'动作',firstPrompt:'构图',seconds:5,aspect:'16:9',audio:'data:audio/mpeg;base64,aGk=',referenceKey:'test',characters:[{name:'小明',character_id:'CHAR-A',image}],characterRefs:['CHAR-B']};
 assert.throws(()=>validateVideo(body),/ID/);body.characterRefs=['CHAR-A'];assert.doesNotThrow(()=>validateVideo(body));
});
