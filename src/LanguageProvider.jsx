import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {Globe,Check} from 'lucide-react';
import {LOCALES,translate} from './i18n.js';
const LanguageContext=createContext({locale:'zh-CN',t:value=>value});
export const useI18n=()=>useContext(LanguageContext);
export function LanguageProvider({children}){
 const [locale,setLocale]=useState(()=>{try{const saved=localStorage.getItem('director-language');return LOCALES.includes(saved)?saved:'zh-CN';}catch{return 'zh-CN';}});
 useEffect(()=>{document.documentElement.lang=locale;try{localStorage.setItem('director-language',locale);}catch{}},[locale]);
 const t=useCallback(value=>translate(value,locale),[locale]);
 return <LanguageContext.Provider value={{locale,setLocale,t}}>{children}<LanguageSwitcher/></LanguageContext.Provider>;
}
function LanguageSwitcher(){
 const {locale,setLocale}=useI18n(),[open,setOpen]=useState(false),container=useRef(null),trigger=useRef(null);
 useEffect(()=>{if(!open)return;const click=e=>{if(!container.current?.contains(e.target))setOpen(false);};const key=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',click);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',click);document.removeEventListener('keydown',key);};},[open]);
 const names={'zh-CN':'简体中文',en:'English',ja:'日本語'};
 return <div className="language-switcher" ref={container}>{open&&<div className="language-options" id="language-options" role="group" aria-label="Language / 语言 / 言語">{LOCALES.map(code=><button key={code} type="button" lang={code} aria-pressed={locale===code} onClick={()=>{setLocale(code);setOpen(false);trigger.current?.focus();}}>{names[code]}{locale===code&&<Check size={14}/>}</button>)}</div>}<button ref={trigger} className="language-trigger" type="button" aria-label="Language / 语言 / 言語" aria-expanded={open} aria-controls="language-options" onClick={()=>setOpen(v=>!v)}><Globe size={16}/><span>{names[locale]}</span></button></div>;
}
