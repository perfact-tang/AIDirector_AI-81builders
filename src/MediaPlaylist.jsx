import {useI18n} from './LanguageProvider.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {Modal} from './GenerationDialog.jsx';

import {generatedPlaylist} from './media-playlist.js';
export {generatedPlaylist};

export default function MediaPlaylist({items,type,onClose}){
 const {t}=useI18n();
 const [index,setIndex]=useState(0),[replay,setReplay]=useState(0),[playing,setPlaying]=useState(false),[finished,setFinished]=useState(false),[error,setError]=useState(''),[blocked,setBlocked]=useState(false);
 const media=useRef(null),list=useRef(null),current=items[index];
 useEffect(()=>{const node=media.current;let active=true;setPlaying(false);setError('');setBlocked(false);
  node.play().catch(e=>{if(active&&e.name!=='AbortError'){if(e.name==='NotAllowedError')setBlocked(true);else setError('此文件暂时无法播放，请检查本机文件，或选择其他条目。');}});
  list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});
  return()=>{active=false;node.pause();};
 },[index,replay]);
 function select(n){media.current?.pause();setFinished(false);if(n===index)setReplay(v=>v+1);else setIndex(n);}
 function ended(){setPlaying(false);if(index+1<items.length)select(index+1);else setFinished(true);}
 async function toggle(){const node=media.current;if(!node.paused){node.pause();return;}try{await node.play();setBlocked(false);}catch{setBlocked(true);}}
 const title=type==='video'?'连续播放动画':'连续播放配音';
 return <Modal title={title} className="playlist-dialog" onCancel={onClose} footer={<button className="small-button" onClick={onClose}>{t("关闭播放器")}</button>}><div className="playlist-layout"><div className="playlist-stage"><div className="playlist-now"><strong>{current.label}</strong><span>{index+1} / {items.length}</span></div>{type==='video'?<video key={`${index}-${replay}`} ref={media} src={current.src} controls playsInline preload="auto" onEnded={ended} onPlay={()=>{setPlaying(true);setFinished(false);setBlocked(false);}} onPause={()=>setPlaying(false)} onError={()=>setError('动画无法读取，请检查本机文件，或选择其他条目。')}/>:<><div className={`playlist-audio-art ${playing?'is-playing':''}`} aria-hidden="true">{[1,2,3,4,5,6,7].map(n=><i key={n} style={{'--bar':n}}/>)}</div><audio key={`${index}-${replay}`} ref={media} src={current.src} controls preload="auto" onEnded={ended} onPlay={()=>{setPlaying(true);setFinished(false);setBlocked(false);}} onPause={()=>setPlaying(false)} onError={()=>setError('配音无法读取，请检查本机文件，或选择其他条目。')}/></>}<p className="playlist-status" role="status">{t(error|| (blocked?'点击播放以开始播放。':finished?'全部播放结束':playing?'正在播放 · 结束后自动播放下一条':'已暂停 / 正在准备播放'))}</p><div className="playlist-controls"><button className="small-button" disabled={index===0} onClick={()=>select(index-1)}>{t("上一条")}</button><button className="small-button save-image" onClick={()=>finished?select(0):toggle()}>{t(finished?'从头播放':playing?'暂停':'播放')}</button><button className="small-button" disabled={index===items.length-1} onClick={()=>select(index+1)}>{t("下一条")}</button></div></div><div className="playlist-queue"><p>{t("播放列表 ")}<span>{items.length}{t(" 条")}</span></p><ol ref={list}>{items.map((item,n)=><li key={item.id}><button aria-current={index===n?'true':undefined} onClick={()=>select(n)}><span className="playlist-number">{index===n&&playing?'▶':String(n+1).padStart(2,'0')}</span><span><strong>{item.label}</strong><small>{type==='video'?t(item.detail):item.detail}</small></span>{index===n&&<span className="playlist-selected">{t("当前")}</span>}</button></li>)}</ol></div></div></Modal>;
}
