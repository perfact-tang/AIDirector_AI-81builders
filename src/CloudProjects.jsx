import React,{useEffect,useState} from 'react';
import {useAuth} from './AuthProvider.jsx';
import {apiJSON} from './cloud-projects.js';
import {useI18n} from './LanguageProvider.jsx';
export default function CloudProjects({onOpen}){
 const {enabled}=useAuth(),{t}=useI18n(),[items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function refresh(){setError('');try{setItems((await apiJSON('/api/projects')).projects);}catch(e){setError(e.message);}}
 useEffect(()=>{if(enabled)refresh();},[enabled]);
 if(!enabled)return null;
 async function open(id){setBusy(true);setError('');try{onOpen(await apiJSON('/api/projects/'+id),id);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="cloud-projects"><div className="section-heading"><h2>{t('我的云端项目')}</h2><button className="small-button" disabled={busy} onClick={refresh}>{t('刷新')}</button></div>{items.length?items.map(item=><button className="cloud-project-row" disabled={busy} key={item.id} onClick={()=>open(item.id)}><strong>{item.name}</strong><span>{item.characters} 人物 · {item.shots} 镜头 · {new Date(item.updatedAt).toLocaleString()}</span></button>):<p>{t('生成方案后，项目会保存到云端。')}</p>}{error&&<p role="alert" className="feedback error">{t(error)}</p>}</section>;
}
