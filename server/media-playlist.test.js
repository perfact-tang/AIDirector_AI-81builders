import test from 'node:test';
import assert from 'node:assert/strict';
import {generatedPlaylist} from '../src/media-playlist.js';
const shots=[{shot_id:'SHOT-001'},{shot_id:'SHOT-002'},{shot_id:'SHOT-003'}];
test('audio playlist follows storyboard order and prefers portable audio while skipping missing clips',()=>{
 const items=generatedPlaylist(shots,{clips:{2:{url:'/third.mp3',text:'第三条'},0:{url:'/first.mp3',dataUrl:'data:audio/mpeg;base64,SUQz',text:'第一条'}}},'audio');
 assert.deepEqual(items.map(i=>[i.id,i.label,i.src]),[[0,'SHOT-001','data:audio/mpeg;base64,SUQz'],[2,'SHOT-003','/third.mp3']]);
 assert.equal(items[1].detail,'第三条');
});
test('video playlist preserves previous playable results and uses the audio policy belonging to that version',()=>{
 const items=generatedPlaylist(shots,{jobs:{0:{status:'in_progress',audioPolicy:'new',previous:{url:'/previous/content',audioPolicy:'locked-v1'}},1:{status:'queued'},2:{url:'/current/content',audioPolicy:'locked-v2',previous:{url:'/older/content'}}}},'video');
 assert.deepEqual(items.map(i=>[i.id,i.src]),[[0,'/previous/content?audio=locked-v1'],[2,'/current/content?audio=locked-v2']]);
 assert.deepEqual(generatedPlaylist(shots,{jobs:{}},'video'),[]);
});
