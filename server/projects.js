import express from 'express';
import {createHash} from 'node:crypto';
import {parseProjectFile} from '../src/project-file.js';
export const validProjectId=id=>typeof id==='string'&&/^[\w-]{16,80}$/.test(id);
export function projectId(data){return validProjectId(data._cloudId)?data._cloudId:createHash('sha256').update(JSON.stringify([data.exported_at,data.project.proposal_id,data.project.direction_name])).digest('hex').slice(0,32);}
function imageBytes(value){const match=typeof value==='string'&&/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);if(!match)throw new Error('图片格式无效。');const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>10*1024*1024)throw new Error('图片大小必须在10MB以内。');return {bytes,mime:match[1]};}
export async function saveProject(store,input,id=projectId(input)){
 const data=parseProjectFile(input);data._cloudId=id;delete data._localId;
 for(const character of data.project.characters){const image=character.generated_assets?.image;const value=typeof image==='string'?image:image?.data_url??image?.dataUrl;
  if(value){const {bytes,mime}=imageBytes(value),key=`images/${id}/${character.character_id}.image`;await store.bytes(key,bytes,mime);await store.write(key+'.json',{mime});character.generated_assets={...character.generated_assets,image:{storage_path:store.objectPath(key)}};}
 }
 await store.write(`projects/${id}.json`,data);
 await store.write(`projects/${id}.summary.json`,{id,name:data.project.direction_name,updatedAt:new Date().toISOString(),characters:data.project.characters.length,shots:data.project.storyboard.reduce((n,s)=>n+s.mvinfo.length,0)});
 return {id};
}
export async function loadProject(store,id){
 const data=await store.read(`projects/${id}.json`);if(!data)return null;
 for(const c of data.project.characters){const key=`images/${id}/${c.character_id}.image`,meta=await store.read(key+'.json');if(meta){const bytes=await store.buffer(key);c.generated_assets={...c.generated_assets,image:{storage_path:store.objectPath(key),data_url:`data:${meta.mime};base64,${bytes.toString('base64')}`}};}}
 return {...data,_cloudId:id};
}
export function projectsRouter(getStore){
 const router=express.Router();
 router.get('/',async(req,res)=>{const store=getStore(req);const keys=await store.list('projects/');const items=await Promise.all(keys.filter(k=>k.endsWith('.summary.json')).map(k=>store.read(k)));res.json({projects:items.filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});});
 router.get('/:id',async(req,res)=>{if(!validProjectId(req.params.id))return res.sendStatus(404);const data=await loadProject(getStore(req),req.params.id);data?res.json(data):res.status(404).json({error:'项目不存在。'});});
 router.post('/:id',async(req,res)=>{if(!validProjectId(req.params.id))return res.sendStatus(400);try{res.json(await saveProject(getStore(req),req.body,req.params.id));}catch(e){res.status(400).json({error:e.message});}});
 router.post('/:id/images/:character',async(req,res)=>{if(!validProjectId(req.params.id)||!/^CHAR-[\w-]+$/.test(req.params.character))return res.sendStatus(400);try{const store=getStore(req),{bytes,mime}=imageBytes(req.body?.image),key=`images/${req.params.id}/${req.params.character}.image`;await store.bytes(key,bytes,mime);await store.write(key+'.json',{mime});res.json({storage_path:store.objectPath(key)});}catch(e){res.status(400).json({error:e.message});}});
 return router;
}
