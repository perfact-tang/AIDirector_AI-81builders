import React, {useState,useEffect,useMemo} from 'react';
import CharacterCard from './CharacterCard.jsx';
import {imageStore,imageKey} from './character-images.js';
import {snapshotProject} from './project-file.js';
import VideoStudio from './VideoStudio.jsx';
import VoiceStudio from './VoiceStudio.jsx';
function Detail({label,value,open=false}) { if(value==null||value==='')return null;return <details className="project-detail" open={open}><summary>{label}</summary><pre>{typeof value==='object'?JSON.stringify(value,null,2):String(value)}</pre></details>; }
export default function ProjectView({data}) {
 const [tab,setTab]=useState('characters');
 const [playbackTarget,setPlaybackTarget]=useState(null);
 const p=data.project,plan=p.director_plan??{},shots=p.storyboard.flatMap((s,i)=>s.mvinfo.map(v=>({...v,segment:s,segmentIndex:i})));
 const [images,setImages]=useState({}),[storageReady,setStorageReady]=useState(false),[assetError,setAssetError]=useState('');
 const [voiceData,setVoiceData]=useState(null);
 const [videoData,setVideoData]=useState(null);
 useEffect(()=>{
  let active=true;
  setStorageReady(false);setImages({});setAssetError('');
  Promise.all(p.characters.map(async(c,i)=>[i,await imageStore(imageKey(data,i))])).then(entries=>{if(active)setImages(Object.fromEntries(entries.filter(([,v])=>v)));}).catch(e=>{if(active)setAssetError(e.message);}).finally(()=>{if(active)setStorageReady(true);});
  return()=>{active=false;};
 },[data]);
 async function saveImage(index,url){await imageStore(imageKey(data,index),url);setImages(previous=>({...previous,[index]:url}));}
 function embeddedImage(c){const image=c.generated_assets?.image;const url=typeof image==='string'?image:image?.data_url??image?.dataUrl??image?.url;return typeof url==='string'&&(/^(data:image\/(png|jpeg|webp);base64,)/i.test(url)||url.startsWith('https://'))?url:'';}
 function download(){
  const output=snapshotProject(data,{images,voice:voiceData,video:videoData});
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='director-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="project-view"><div className="project-header"><div><div className="eyebrow">DIRECTOR’S CUT / {data._localId?'已读取项目存档':'校验通过'}</div><h2>{p.direction_name}</h2><p>{plan.style_name} · {plan.total_duration_seconds} 秒 · {p.characters.length} 位人物 · {shots.length} 个镜头</p></div><button type="button" className="export-button" disabled={!storageReady||!voiceData||!videoData} onClick={download}>保存项目 JSON ↗</button></div><p className="project-file-note">项目 JSON 保存修改记录、图片、配音与动画路径；动画文件仍位于本机，请同时下载动画 ZIP 备份。</p><div className="project-navigation"><nav className="project-tabs" aria-label="项目视图">{[['characters','人物展示'],['audio','声音设计'],['shots','分镜展示']].map(([key,label])=><button type="button" key={key} aria-pressed={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</nav><div className="project-tab-actions" ref={setPlaybackTarget}/></div>
 {tab==='characters'&&<>{assetError&&<p className="asset-message" role="alert">{assetError}</p>}{p.characters.map((c,i)=><CharacterCard key={imageKey(data,i)} character={c} index={i} image={images[i]||embeddedImage(c)} storageReady={storageReady} onSave={url=>saveImage(i,url)}/>)}{!p.characters.length&&<p>此项目没有跨镜头人物。</p>}</>}
 <VoiceStudio playbackTarget={playbackTarget} data={data} onChange={setVoiceData} visible={tab==='audio'}/>
 <VideoStudio playbackTarget={playbackTarget} data={data} voiceData={voiceData} characterImages={images} imagesReady={storageReady} visible={tab==='shots'} onChange={setVideoData}/>
 <Detail label="完整项目 JSON" value={data}/></section>;
}
