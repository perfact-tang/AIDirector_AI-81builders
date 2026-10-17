import React,{useEffect,useId,useRef} from 'react';
import {createPortal} from 'react-dom';

export function Modal({title,children,footer,onCancel,className=''}){
 const ref=useRef(null),id=useId();
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement;dialog.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=overflow;previous?.focus?.();};},[]);
 return createPortal(<dialog ref={ref} className={`generation-dialog ${className}`} aria-labelledby={id} onCancel={e=>{e.preventDefault();onCancel?.();}}><div className="generation-heading"><span className="generation-eyebrow">DIRECTOR / STUDIO</span><h2 id={id}>{title}</h2></div>{children}<div className="generation-footer">{footer}</div></dialog>,document.body);
}
export default function GenerationDialog({title,rows,onStop,video=false,paused=false,onResume}){
 const list=useRef(null);
 const activeIndex=rows.findIndex(r=>r.status==='running');
 useEffect(()=>{list.current?.querySelector('.is-running')?.scrollIntoView({block:'nearest'});},[activeIndex]);
 const completed=rows.filter(r=>['completed','failed'].includes(r.status)).length;
 return <Modal title={title} footer={<>{paused&&<button className="small-button save-image" onClick={onResume}>继续查询 / 处理</button>}<button className="small-button generation-stop" onClick={onStop}>{video&&rows.length>1?'全部停止':'停止'}</button></>}><p className="generation-summary" role="status">{paused?'生成已暂停，请查看提示后继续。':`生成中 · 已处理 ${completed} / ${rows.length} 条`}</p><progress className="generation-progress" value={completed} max={rows.length||1} aria-label="生成进度"/><ol ref={list} className="generation-list">{rows.map((r,i)=><li key={r.index} className={`generation-row is-${r.status}`}><span className="generation-marker">{r.status==='completed'?'✓':r.status==='failed'?'!':String(i+1).padStart(2,'0')}</span><div><strong>第 {i+1} 条 · {r.label}</strong><p>{r.detail||({waiting:'等待生成',running:'生成中…',completed:'已结束 · 生成完成',failed:'已结束 · 生成失败'}[r.status])}</p></div></li>)}</ol>{video&&<p className="generation-note">停止后不再提交后续镜头。已提交给 ai& 的动画无法取消，将在后台继续处理并保留结果。</p>}</Modal>;
}
