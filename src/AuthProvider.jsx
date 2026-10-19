import {setBrowserOwner} from './browser-owner.js';
import React,{createContext,useContext,useEffect,useState} from 'react';
import {initializeApp} from 'firebase/app';
import {getAuth,setPersistence,inMemoryPersistence,signInWithEmailAndPassword,signInWithPopup,GoogleAuthProvider,signOut} from 'firebase/auth';
import {useI18n} from './LanguageProvider.jsx';
const Context=createContext({enabled:false,user:null});
export const useAuth=()=>useContext(Context);
export function AuthProvider({children}){
 const {t}=useI18n();
 const [settings,setSettings]=useState(null),[user,setUser]=useState(null),[auth,setAuth]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;
  (async()=>{const response=await fetch('/api/auth/config');if(!response.ok)throw new Error('无法读取登录配置。');const config=await response.json();if(!active)return;setSettings(config);
   if(config.enabled){const instance=getAuth(initializeApp(config.config));await setPersistence(instance,inMemoryPersistence);setAuth(instance);const res=await fetch('/api/auth/me');if(res.ok){const data=await res.json();if(active){setBrowserOwner(data.user.uid);setUser(data.user);}}}
  })().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[]);
 async function login(email,password,google=false){setBusy(true);setError('');try{
  const credential=google?await signInWithPopup(auth,new GoogleAuthProvider()):await signInWithEmailAndPassword(auth,email,password);
  const idToken=await credential.user.getIdToken(),csrf=await(await fetch('/api/auth/csrf')).json();
  const response=await fetch('/api/auth/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken,csrfToken:csrf.token})});const data=await response.json();if(!response.ok)throw new Error(data.error);
  await signOut(auth);setBrowserOwner(data.user.uid);setUser(data.user);
 }catch(e){setError(e.code==='auth/invalid-credential'?'邮箱或密码不正确。':e.code==='auth/popup-closed-by-user'?'登录已取消。':e.code==='auth/unauthorized-domain'?'此域名尚未加入 Firebase 登录授权列表。':e.message);}finally{setBusy(false);}}
 async function logout(){setBusy(true);try{const response=await fetch('/api/auth/logout',{method:'POST'});if(!response.ok)throw new Error('退出失败，请重试。');setBrowserOwner('local');setUser(null);sessionStorage.removeItem('director-job');location.assign('/');}catch(e){setError(e.message);setBusy(false);}}
 if(loading)return <main className="auth-screen"><p role="status">{t('正在检查登录状态…')}</p></main>;
 if(!settings)return <main className="auth-screen"><p role="alert">{t(error)}</p><button className="small-button" onClick={()=>location.reload()}>{t('重试')}</button></main>;
 if(settings.enabled&&!user)return <main className="auth-screen"><form className="login-panel" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);login(form.get('email'),form.get('password'));}}><div className="eyebrow">AI DIRECTOR</div><h1>{t('登录导演工作台')}</h1><p>{t('使用现有 Firebase 账号继续。')}</p><label>{t('邮箱')}<input name="email" type="email" autoComplete="username" required disabled={busy}/></label><label>{t('密码')}<input name="password" type="password" autoComplete="current-password" required disabled={busy}/></label><button className="submit" disabled={busy||!auth}>{t(busy?'正在登录…':'登录')}</button>{settings.googleEnabled&&<button className="export-button" type="button" disabled={busy||!auth} onClick={()=>login(null,null,true)}>{t('使用 Google 登录')}</button>}{error&&<p className="feedback error" role="alert">{t(error)}</p>}</form></main>;
 return <Context.Provider value={{enabled:settings.enabled,user,logout,busy}}><React.Fragment key={user?.uid||'local'}>{children}</React.Fragment></Context.Provider>;
}
export function AccountButton(){const {enabled,user,logout,busy}=useAuth();const {t}=useI18n();return enabled?<div className="account-menu"><span>{user.email||user.uid}</span><button className="small-button" disabled={busy} onClick={logout}>{t('退出登录')}</button></div>:null;}
