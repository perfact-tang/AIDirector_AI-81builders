import {LanguageProvider,useI18n} from './LanguageProvider.jsx';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, ArrowRight, Check, Clapperboard, Film, Zap, MoveRight, LoaderCircle } from 'lucide-react';
import './styles.css';
import ProjectView from './ProjectView.jsx';
import {imageStore} from './character-images.js';
import {parseProjectFile} from './project-file.js';
import ProcessingView from './ProcessingView.jsx';
const styles = [
  { id: 'realistic-3d', name: '真实 3D', en: 'CINEMATIC REALISM', cls: 'realistic', description: '电影质感，真实光影', number: '01' },
  { id: 'anime', name: '日本动漫', en: 'JAPANESE ANIME', cls: 'anime', description: '细腻笔触，想象无限', number: '02' },
  { id: '2.5d', name: '2.5D 效果', en: 'STYLIZED DIMENSION', cls: 'dimension', description: '平面与立体之间', number: '03' },
];
const empty = { style: 'realistic-3d', pace: 5, content: '' };
function restore() { try { const d = JSON.parse(localStorage.getItem('director-draft')); return d && styles.some(s => s.id === d.style) && [5,10].includes(d.pace) && typeof d.content === 'string' ? {...d, content: d.content.slice(0,12000)} : empty; } catch { return empty; } }
function App() {
 const {t,locale}=useI18n();
  const [screen, setScreen] = useState(() => new URLSearchParams(location.search).has('local') ? 'loading-project' : location.pathname === '/processing' || location.pathname === '/project' || new URLSearchParams(location.search).has('job') ? 'processing' : 'brief');
  useEffect(() => { document.title = `${t(screen === 'brief' ? '导演台' : screen === 'processing' ? 'AI 处理中' : '创建方案')} · AI DIRECTOR`; },[screen,t]);
  const [localId,setLocalId]=useState(()=>new URLSearchParams(location.search).get('local'));
  const [importing,setImporting]=useState(false);
  function navigate(view,id,replace=false) {
    setLocalId(null);
    const url = view === 'brief' ? '/' : `/${view === 'result' ? 'project' : 'processing'}${id ? '?job='+encodeURIComponent(id) : ''}`;
    history[replace?'replaceState':'pushState']({},'',url); setScreen(view); window.scrollTo(0,0);
  }
  useEffect(() => { const onPop = () => {
    const params=new URLSearchParams(location.search),id=params.get('job'),local=params.get('local');
    setError('');
    if(local){setLocalId(local);setScreen('loading-project');setJob(null);}
    else if(id){setLocalId(null);setJob({id,status:'running',stage:'正在恢复任务进度'});setScreen('processing');}
    else {setLocalId(null);setScreen('brief');}
  }; window.addEventListener('popstate',onPop); return()=>window.removeEventListener('popstate',onPop); },[]);

  const [draft, setDraft] = useState(restore), [busy, setBusy] = useState(false), [result, setResult] = useState(null), [error, setError] = useState('');
  useEffect(() => { try { localStorage.setItem('director-draft', JSON.stringify(draft)); } catch {} }, [draft]);
  const update = (data) => { setDraft(d => ({...d, ...data})); setResult(null); setError(''); };
  const [job, setJob] = useState(() => { try { if(new URLSearchParams(location.search).has('local'))return null; const id = new URLSearchParams(location.search).get('job') || (location.pathname === '/processing' || location.pathname === '/project' ? sessionStorage.getItem('director-job') : null); return id ? {id,status:'running',stage:'正在恢复任务进度'} : null; } catch { return null; } });
  useEffect(() => { if(job?.status === 'running') setBusy(true); }, [job?.status]);
  const [pollVersion,setPollVersion] = useState(0);
  useEffect(() => {
    if (!job?.id || job.status !== 'running') return;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const res = await fetch(`/api/scripts/${job.id}`, {signal:controller.signal});
        const data = await res.json(); if (!res.ok) throw new Error(data.error);
        setJob(data);
        if (data.status === 'completed') { setResult(data); setBusy(false); if(location.pathname !== '/' || new URLSearchParams(location.search).has('job')) navigate('result',data.id,true); }
        else if(data.status === 'failed') { setError(data.error); setBusy(false); }
        else timer = setTimeout(poll, 2000);
      } catch(e) { if(e.name !== 'AbortError') { setError(e.message); setBusy(false); } }
    }
    timer = setTimeout(poll, 1500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [job?.id, job?.status, pollVersion]);
  useEffect(()=>{
    if(!localId)return;
    let active=true;setError('');setBusy(false);
    imageStore('project-import:'+localId).then(record=>{
      if(!record)throw new Error('此浏览器中没有该项目存档，请重新读取 JSON 文件。');
      const project=parseProjectFile(record);
      if(active){setResult({id:localId,project:{...project,_localId:localId}});setJob(null);setScreen('result');window.scrollTo(0,0);}
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[localId]);
  async function importProject(event){
    const file=event.target.files[0];event.target.value='';if(!file)return;
    setImporting(true);setError('');
    try{
      if(file.size>100*1024*1024)throw new Error('项目 JSON 超过 100 MB，请使用不内嵌大型视频的存档。');
      const project=parseProjectFile(await file.text()),id=crypto.randomUUID();
      await imageStore('project-import:'+id,project);
      setJob(null);setBusy(false);setResult(null);
      history.pushState({},'',`/project?local=${encodeURIComponent(id)}`);setScreen('loading-project');setLocalId(id);
    }catch(e){setError(e instanceof SyntaxError?'JSON 文件无法解析，请选择有效的项目 JSON。':e.message);}
    finally{setImporting(false);}
  }
  async function submit(e) {
    e.preventDefault(); if (!draft.content.trim()) { setError('先写下你的故事或灵感。'); return; }
    setBusy(true); setError(''); setResult(null); setJob({status:'running',stage:'正在提交创作需求',createdAt:Date.now()}); navigate('processing');
    try {
      const res = await fetch('/api/scripts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
      const data = await res.json(); if (!res.ok) throw new Error(data.error); setJob(data); navigate('processing',data.id,true); try { sessionStorage.setItem('director-job',data.id); } catch {}
    } catch(e) { setError(e.message); setBusy(false); }
  }
  return <div className="app"><header><a className="brand" href="/" onClick={e=>{e.preventDefault();navigate('brief');}} aria-label={t("AI Director 首页")}><span className="brand-icon"><Clapperboard size={22}/></span>AI DIRECTOR<span className="brand-tag">{t("导演台")}</span></a><div className="header-right"><span className="version">WORKSPACE / V.01</span><span className="avatar">D.</span></div></header>
    <main>{screen === 'brief' && <><div className="intro"><div><div className="eyebrow"><span/> THE DIRECTOR’S WORKSPACE</div><h1>{t("你的想象，")}<span>{t("即将开拍。")}</span><i>↗</i></h1><p>{t("设定画面与节奏，把故事的第一步交给灵感。")}</p></div><div className="slate"><Film size={17}/><span>NEW PRODUCTION</span><strong>001<span> / TAKE ONE</span></strong></div></div>
    <div className="import-project"><div><strong>{t("继续已有项目")}</strong><p>{t("读取已保存的 JSON，恢复修改、配音与动画，无需重新生成。")}</p></div><label className="export-button upload-button">{t(importing?'正在读取…':'读取项目 JSON ↗')}<input type="file" accept=".json,application/json" aria-label={t("读取项目 JSON")} disabled={importing||busy} onChange={importProject}/></label></div>
    {busy && job?.id && <button className="export-button resume-task" type="button" onClick={()=>navigate('processing',job.id)}>{t("查看正在处理的任务 →")}</button>}<form onSubmit={submit}><fieldset disabled={busy} className="brief-fieldset"><section className="style-section"><div className="section-heading"><h2><span>01</span>{t("选择画风")}</h2><span className="section-note">{t("为你的故事定下视觉基调")}</span></div><div className="style-grid" role="radiogroup" aria-label={t("画风选择")}>{styles.map(s => <button type="button" role="radio" aria-checked={draft.style === s.id} className={`style-card ${s.cls} ${draft.style === s.id ? 'selected' : ''}`} key={s.id} onClick={() => update({ style:s.id })}><div className="art" aria-hidden="true"><span className="art-sun"/><span className="art-building b1"/><span className="art-building b2"/><span className="art-building b3"/><span className="art-floor"/><span className="art-person"/><span className="art-orbit"/></div><span className="card-index">{s.en}</span><span className="selection">{draft.style === s.id && <Check size={14}/>}</span><div className="card-info"><div><h3>{t(s.name)}</h3><p>{t(s.description)}</p></div><span className="style-number">{s.number}</span></div></button>)}</div></section>
    <section className="pace-section"><div className="section-heading"><h2><span>02</span>{t("设定节奏")}</h2><span className="section-note">{t("每个镜头的呼吸感")}</span></div><div className="pace-grid" role="radiogroup" aria-label={t("动画节奏")}>{[5,10].map(p => <button type="button" role="radio" aria-checked={draft.pace === p} className={`pace-option ${draft.pace === p ? 'active' : ''}`} key={p} onClick={() => update({pace:p})}><span className="pace-icon">{p === 5 ? <Zap size={21}/> : <MoveRight size={24}/>}</span><span className="pace-label"><strong>{t(p === 5 ? '快节奏' : '慢节奏')}</strong><small>{t(p === 5 ? '紧凑切换，瞬间抓住注意力' : '从容叙事，让情绪慢慢发生')}</small></span><span className="seconds">{p}<small>{t("秒 / 镜头")}</small></span><span className="radio-dot"/></button>)}</div></section>
    <section className="content-section"><div className="section-heading"><h2><span>03</span><label htmlFor="content">{t("写下你的灵感")}</label></h2><span className="section-note">{t("故事、歌词、一个念头，都可以")}</span></div><div className="text-wrap"><textarea id="content" maxLength={12000} value={draft.content} onChange={e => update({content:e.target.value})} placeholder={t('故事从哪里开始？\n\n可以是一段故事、一首歌词，或是一个还没成形的想法……')}/><div className="textarea-footer"><span><span className="tiny-square"/>{t(" 让想象自由一点")}</span><span>{draft.content.length.toLocaleString(locale)} / 12,000</span></div></div></section>
    </fieldset><div className="action-row"><span className="draft-note"><span/>{t(" 草稿自动保存在此浏览器")}</span><button className="submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={18}/> : <Clapperboard size={18}/>} {t(busy ? '正在提交创作需求…' : '让我来帮你想脚本')}<ArrowUpRight size={21}/></button></div>
    {error && <div className="feedback error" role="alert">{t(error)}</div>}
    </form></>}
    {screen === 'loading-project' && <div className="processing-page"><div className="eyebrow">OPEN SAVED PROJECT</div><h1>{t("读取项目存档")}</h1><p role="status">{t(error||'正在从本地浏览器恢复项目，不会调用生成服务。')}</p>{error&&<button className="export-button" onClick={()=>navigate('brief')}>{t("返回读取 JSON")}</button>}</div>}
    {screen === 'processing' && <ProcessingView job={job} error={t(error)} onBack={()=>navigate('brief')} onReconnect={()=>{setError('');setJob(j=>({...j,status:'running'}));setBusy(true);setPollVersion(v=>v+1);}}/>}
    {screen === 'result' && result?.project && <div className="result-page"><div className="result-toolbar"><span className="eyebrow">{t("PRODUCTION / 创建方案")}</span><button type="button" className="export-button" onClick={()=>navigate('brief')}>{t("← 返回修改需求")}</button></div><ProjectView key={result.id} data={result.project}/>{result.prompt && <details className="prompt-preview"><summary>{t("查看创作需求")}</summary><pre>{result.prompt}</pre></details>}</div>}
    <footer><span>AI DIRECTOR <span className="footer-slash">/</span>{t(" 从灵感到镜头")}</span><span>YOUR VISION. YOUR DIRECTION.<ArrowRight size={13}/></span></footer></main></div>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><App/></LanguageProvider>);
