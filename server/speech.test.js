import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechReader,dialogue} from '../src/speech.js';
import {imageKey,readImage} from '../src/character-images.js';
test('all-reading advances in order, skips silent shots, and stop cancels old callbacks',()=>{
 const played=[];let cancelled=0;
 const synth={cancel(){cancelled++;},resume(){},pause(){},getVoices(){return [{name:'Ting-Ting',lang:'zh-CN'}];},speak(u){played.push(u);}};
 class Utterance{constructor(text){this.text=text;}}
 const reader=new SpeechReader({synth,Utterance});
 reader.play([{key:'1',label:'一',text:dialogue('你好')},{key:'2',text:dialogue('无对白')},{key:'3',label:'三',text:dialogue('再见')}],'zh-CN');
 assert.equal(played[0].text,'你好');reader.togglePause();assert.equal(reader.state.paused,true);reader.togglePause();assert.equal(reader.state.paused,false);
 played[0].onend();assert.equal(played[1].text,'再见');reader.stop();played[1].onend();assert.equal(played.length,2);assert.equal(reader.state.active,false);assert.ok(cancelled>=2);
 reader.play([{key:'single',text:'单条'}],'zh-CN');assert.equal(played.at(-1).text,'单条');played.at(-1).onend();assert.equal(reader.state.message,'朗读完成。');
});
test('missing speech support or voice produces actionable messages',()=>{
 const reader=new SpeechReader({});reader.play([{text:'你好'}],'zh-CN');assert.equal(reader.state.active,false);assert.ok(reader.state.message);
 const noVoice=new SpeechReader({synth:{cancel(){},getVoices(){return [];}},Utterance:class{}});noVoice.play([{text:'你好'}],'zh-CN');assert.match(noVoice.state.message,/尚未加载/);
});
test('image storage is scoped per character and project; invalid uploads rejected',async()=>{
 const data={exported_at:'2026',project:{direction_name:'test',proposal_id:1,characters:[{description:'one'},{description:'two'}]}};
 assert.notEqual(imageKey(data,0),imageKey(data,1));assert.notEqual(imageKey(data,0),imageKey({...data,exported_at:'2027'},0));
 await assert.rejects(readImage({type:'text/html',size:10}),/PNG/);await assert.rejects(readImage({type:'image/png',size:11*1024*1024}),/10 MB/);
});
