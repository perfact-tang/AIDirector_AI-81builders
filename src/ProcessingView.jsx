import React, { useEffect, useState } from 'react';
import { Check, LoaderCircle, ArrowLeft, AlertCircle } from 'lucide-react';
const explanations = {
 '正在恢复任务进度': '正在连接本地服务，读取此任务的最新执行状态。',
 '正在提交创作需求': '正在将画风、镜头节奏和你的灵感发送给导演。',
 '正在读取本地 skill': '正在加载导演规范、角色设定要求、分镜协议与项目模板。',
 '正在调用模型编写导演方案': 'AI 正在根据你的需求编写完整方案，包含视觉风格、人物、声音设计和逐镜头提示词。',
 '正在校验人物、声音与分镜数据': '正在运行项目校验器，检查角色设定、声音计划、镜头结构与时长。',
 '生成完成': '方案已通过校验，即将打开创建方案。',
};
export default function ProcessingView({job,error,onBack,onReconnect}) {
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const elapsed=Math.max(0,Math.floor((now-(job?.createdAt??now))/1000));
 const events=job?.events?.length?job.events:[{stage:job?.stage||'正在提交创作需求',at:job?.createdAt}];
 const stage=job?.stage||'正在提交创作需求';
 return <div className="processing-page"><div className="eyebrow">PRODUCTION IN PROGRESS</div><div className={`processing-symbol ${error?'has-error':''}`}>{error?<AlertCircle size={35}/>:<LoaderCircle size={35} className="spin"/>}</div><h1>{error?'创作暂时中断':'AI 导演正在工作'}<span className="processing-period">.</span></h1><p className="processing-subtitle">{error?'你的输入仍然保留，可以返回调整或重新连接任务。':'从灵感到镜头，正在为你组织完整的创作方案。'}</p><div className="processing-meta"><span>DEEPSEEK V4.1 FLASH</span><span>已用 {Math.floor(elapsed/60).toString().padStart(2,'0')}:{(elapsed%60).toString().padStart(2,'0')}</span></div><div className="current-stage" role="status" aria-live="polite"><span className="eyebrow">{error?'需要处理':'当前阶段'}</span><h2>{error||stage}</h2><p>{!error&&(explanations[stage]||(stage.includes('修正')?'发现了需要调整的结构，AI 正在根据校验反馈修正完整方案。':'正在处理创作需求。'))}</p>{!error&&<div className="activity-track"><span/></div>}</div><ol className="stage-timeline" aria-label="实际处理记录">{events.map((event,i)=><li key={i} className={i===events.length-1?'current':''}><span className="timeline-icon">{i<events.length-1?<Check size={13}/>:error?<AlertCircle size={13}/>:<LoaderCircle size={13} className="spin"/>}</span><span>{event.stage}</span><time>{event.at?new Date(event.at).toLocaleTimeString('zh-CN',{hour12:false}):'现在'}</time></li>)}</ol>{error?<div className="processing-actions"><button className="export-button" onClick={onBack}><ArrowLeft size={14}/> 返回修改需求</button>{job?.id&&job.status==='running'&&<button className="export-button" onClick={onReconnect}>重新连接任务</button>}</div>:<p className="waiting-note">生成可能需要数分钟。完成后将自动进入方案页，你也可以刷新此页继续查看。<br/>阶段记录来自实际执行状态；模型生成期间暂不提供内部逐步进度。</p>}</div>;
}
