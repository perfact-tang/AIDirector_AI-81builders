import {useAuth} from './AuthProvider.jsx';
import {apiJSON,cloudSave} from './cloud-projects.js';
import {useI18n} from './LanguageProvider.jsx';
import React, {useState,useEffect,useMemo,useRef} from 'react';
import CharacterCard from './CharacterCard.jsx';
import {imageStore,imageKey,legacyImageKey} from './character-images.js';
import {snapshotProject} from './project-file.js';
import VideoStudio from './VideoStudio.jsx';
import VoiceStudio from './VoiceStudio.jsx';
function Detail({label,value,open=false}) {
 const {t}=useI18n(); if(value==null||value==='')return null;return <details className="project-detail" open={open}><summary>{t(label)}</summary><pre>{typeof value==='object'?JSON.stringify(value,null,2):String(value)}</pre></details>; }
export default function ProjectView({data}) {
 const {t}=useI18n();
 const {enabled:cloudEnabled}=useAuth();
 const saveChain=useRef(Promise.resolve());
 const [cloudSaving,setCloudSaving]=useState(false),[cloudMessage,setCloudMessage]=useState('');
 const [tab,setTab]=useState('characters');
 const [playbackTarget,setPlaybackTarget]=useState(null);
 const p=data.project,plan=p.director_plan??{},shots=p.storyboard.flatMap((s,i)=>s.mvinfo.map(v=>({...v,segment:s,segmentIndex:i})));
 const [images,setImages]=useState({}),[storageReady,setStorageReady]=useState(false),[assetError,setAssetError]=useState('');
 const [voiceData,setVoiceData]=useState(null);
 const [videoData,setVideoData]=useState(null);
 useEffect(()=>{
  let active=true;
  setStorageReady(false);setImages({});setAssetError('');
  if(cloudEnabled&&data._cloudId){setStorageReady(true);return()=>{active=false;};}
  Promise.all(p.characters.map(async(c,i)=>[i,(await imageStore(imageKey(data,i)))||(await imageStore(legacyImageKey(data,i)))])).then(entries=>{if(active)setImages(Object.fromEntries(entries.filter(([,v])=>v)));}).catch(e=>{if(active)setAssetError(e.message);}).finally(()=>{if(active)setStorageReady(true);});
  return()=>{active=false;};
 },[data,cloudEnabled]);
 async function saveImage(index,url){if(cloudEnabled&&data._cloudId)await apiJSON(`/api/projects/${data._cloudId}/images/${p.characters[index].character_id}`,{method:'POST',body:JSON.stringify({image:url})});try{await imageStore(imageKey(data,index),url);}catch(e){if(!cloudEnabled)throw e;setAssetError('图片已保存到云端，浏览器本地缓存失败。');}setImages(previous=>({...previous,[index]:url}));}
 function embeddedImage(c){const image=c.generated_assets?.image;const url=typeof image==='string'?image:image?.data_url??image?.dataUrl??image?.url;return typeof url==='string'&&(/^(data:image\/(png|jpeg|webp);base64,)/i.test(url)||url.startsWith('https://'))?url:'';}
 function queueCloudSave(){const output=snapshotProject(data,{images,voice:voiceData,video:videoData});output._cloudId=data._cloudId||crypto.randomUUID();const pending=saveChain.current.catch(()=>{}).then(()=>cloudSave(output));saveChain.current=pending;return pending;}
 async function saveCloud(){setCloudSaving(true);setCloudMessage('');try{await queueCloudSave();setCloudMessage('项目已保存到云端。');}catch(e){setCloudMessage(e.message);}finally{setCloudSaving(false);}}
 useEffect(()=>{if(!cloudEnabled||!data._cloudId||!storageReady||!voiceData||!videoData)return;let active=true;const timer=setTimeout(()=>{queueCloudSave().then(()=>{if(active)setCloudMessage('项目已自动保存到云端。');}).catch(e=>{if(active)setCloudMessage('云端保存失败：'+e.message);});},2000);return()=>{active=false;clearTimeout(timer);};},[cloudEnabled,data,images,voiceData,videoData,storageReady]);
 function download(){
  const output=snapshotProject(data,{images,voice:voiceData,video:videoData});
  const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='director-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <section className="project-view"><div className="project-header"><div><div className="eyebrow">DIRECTOR’S CUT / {t(data._localId?'已读取项目存档':'校验通过')}</div><h2>{p.direction_name}</h2><p>{plan.style_name} · {plan.total_duration_seconds}{t(" 秒 · ")}{p.characters.length}{t(" 位人物 · ")}{shots.length}{t(" 个镜头")}</p></div>{cloudEnabled&&<button type="button" className="export-button" disabled={cloudSaving||!storageReady||!voiceData||!videoData} onClick={saveCloud}>{t(cloudSaving?'正在保存…':'保存到云端')}</button>}<button type="button" className="export-button" disabled={!storageReady||!voiceData||!videoData} onClick={download}>{t("保存项目 JSON ↗")}</button></div>{cloudMessage&&<p className="asset-message" role="status">{t(cloudMessage)}</p>}<p className="project-file-note">{t(cloudEnabled?'图片、配音与动画保存在云端，编辑记录会自动保存；也可下载 JSON 与 ZIP 备份。':'项目 JSON 保存修改记录、图片、配音与动画路径；动画文件仍位于本机，请同时下载动画 ZIP 备份。')}</p><div className="project-navigation"><nav className="project-tabs" aria-label={t("项目视图")}>{[['characters','人物展示'],['audio','声音设计'],['shots','分镜展示']].map(([key,label])=><button type="button" key={key} aria-pressed={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{t(label)}</button>)}</nav><div className="project-tab-actions" ref={setPlaybackTarget}/></div>
 {tab==='characters'&&<>{assetError&&<p className="asset-message" role="alert">{t(assetError)}</p>}{p.characters.map((c,i)=><CharacterCard key={imageKey(data,i)} character={c} cloud={cloudEnabled} index={i} image={images[i]||embeddedImage(c)} storageReady={storageReady} onSave={url=>saveImage(i,url)}/>)}{!p.characters.length&&<p>{t("此项目没有跨镜头人物。")}</p>}</>}
 <VoiceStudio videoData={videoData} playbackTarget={playbackTarget} data={data} onChange={setVoiceData} cloud={cloudEnabled} visible={tab==='audio'}/>
 <VideoStudio playbackTarget={playbackTarget} data={data} voiceData={voiceData} characterImages={images} imagesReady={storageReady} visible={tab==='shots'} onChange={setVideoData} cloud={cloudEnabled}/>
 <Detail label={t("完整项目 JSON")} value={data}/></section>;
}
