import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCharacters,characterSources,currentVoice,referencePlan} from '../src/video-references.js';
const image='data:image/png;base64,aGk=';
const people=[{name:'Mochi（麻薯）'},{name:'Pip'},{name:'Ann'},{name:'Anna'},{name:'小明'},{name:'小明妈妈'}];
test('matches named characters in prompt order, including CJK-adjacent names and aliases',()=>{
 assert.deepEqual(matchCharacters('Pip坐下，Mochi在旁边，麻薯抬头。',people).map(c=>c.index),[1,0]);
 assert.deepEqual(matchCharacters('Anna说话，小明妈妈微笑。',people).map(c=>c.index),[3,5]);
 assert.deepEqual(matchCharacters('树林空镜，日光。',people),[]);
});
test('reference plan requires current narration and all explicitly mentioned character images',()=>{
 const data={project:{characters:people}},sources=characterSources(data,{0:image,1:image});
 const state={texts:['你好'],voice:'voice',clips:{0:{text:'你好',voice:'voice',dataUrl:'data:audio/mpeg;base64,aGk='}}};
 const clip=currentVoice(state,0),plan=referencePlan('Mochi和Pip在说话',people,sources,clip);
 assert.equal(plan.problems.length,0);assert.deepEqual(plan.refs.map(r=>r.name),['Mochi（麻薯）','Pip']);
 assert.ok(referencePlan('Ann说话',people,sources,clip).problems.some(p=>p.includes('Ann')));
 assert.ok(referencePlan('Mochi说话',people,sources,null).problems.some(p=>p.includes('配音')));
 assert.equal(currentVoice({...state,texts:['已修改']},0),null);
 assert.notEqual(referencePlan('Mochi说话',people,sources,clip).key,referencePlan('Mochi说话',people,sources,{...clip,dataUrl:'data:audio/mpeg;base64,bmV3'}).key);
 assert.notEqual(plan.key,referencePlan('Mochi和Pip在说话',people,characterSources(data,{0:'data:image/png;base64,bmV3',1:image}),clip).key);
});
test('no-character shot needs a scene image and unresolved media placeholders are blocked',()=>{
 const clip={dataUrl:'data:audio/mpeg;base64,aGk='};
 assert.ok(referencePlan('森林空镜',people,[],clip).problems.length);
 assert.equal(referencePlan('森林空镜',people,[],clip,image).problems.length,0);
 assert.ok(referencePlan('<Subject 1> 望向远方。',people,[],clip,image).problems.some(p=>p.includes('姓名')));
});

test('shortening a shot invalidates an overlong checked voice without rejecting shorter narration',()=>{
 const state={texts:['你好'],voice:'voice',clips:{0:{text:'你好',voice:'voice',duration:10,dataUrl:'data:audio/mpeg;base64,aGk='}}};
 assert.equal(currentVoice(state,0,5),null);assert.equal(currentVoice(state,0,10),state.clips[0]);assert.equal(currentVoice(state,0,15),state.clips[0]);
});
