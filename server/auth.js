import express from 'express';
import {randomBytes,timingSafeEqual} from 'node:crypto';
const cookie='__session';
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').flatMap(part=>{const at=part.indexOf('=');return at<0?[]:[[part.slice(0,at).trim(),part.slice(at+1)]];}));}
export function sameOrigin(req){
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 const origin=req.headers.origin;
 if(!origin)return true;
 return origin===`${req.protocol}://${req.get('host')}`;
}
export function authRouter({auth,enabled=false,config={}}={}){
 const router=express.Router(),options=req=>({httpOnly:true,secure:req.secure,sameSite:'strict',path:'/'});
 router.get('/config',(_req,res)=>res.json({enabled,config:enabled?config:{},googleEnabled:process.env.FIREBASE_GOOGLE_LOGIN==='true'}));
 router.get('/csrf',(req,res)=>{const token=randomBytes(32).toString('hex');res.cookie('director_csrf',token,{...options(req),maxAge:3600000});res.set('Cache-Control','no-store').json({token});});
 router.post('/session',express.json({limit:'20kb'}),async(req,res)=>{
  if(!enabled)return res.status(400).json({error:'云端登录未启用。'});
  const expected=cookies(req).director_csrf||'',given=req.body?.csrfToken;
  if(!sameOrigin(req)||typeof given!=='string'||given.length!==64||expected.length!==64||!timingSafeEqual(Buffer.from(expected),Buffer.from(given)))return res.status(403).json({error:'登录校验已过期，请刷新重试。'});
  try{
   const token=req.body.idToken;if(typeof token!=='string')throw new Error('Missing token');
   const user=await auth.verifyIdToken(token,true);
   if(Date.now()/1000-user.auth_time>300)throw new Error('Sign in again');
   const expiresIn=5*24*60*60*1000,session=await auth.createSessionCookie(token,{expiresIn});
   res.cookie(cookie,session,{...options(req),maxAge:expiresIn}).set('Cache-Control','no-store').json({user:{uid:user.uid,email:user.email||''}});
  }catch{res.status(401).json({error:'登录验证失败，请重新登录。'});}
 });
 router.post('/logout',(req,res)=>{if(!sameOrigin(req))return res.sendStatus(403);res.clearCookie(cookie,options(req)).json({ok:true});});
 return router;
}
export function requireUser(auth){return async(req,res,next)=>{
 try{const session=cookies(req)[cookie];if(!session)throw new Error('No session');req.user=await auth.verifySessionCookie(session,true);res.set('Cache-Control','private, no-store');next();}
 catch{res.status(401).json({error:'请登录后继续。'});}
};}
