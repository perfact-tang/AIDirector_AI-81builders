import {CloudTasksClient} from '@google-cloud/tasks';
import {OAuth2Client} from 'google-auth-library';
import express from 'express';
import {createHash} from 'node:crypto';
export function createTaskQueue({client=new CloudTasksClient(),project=process.env.GOOGLE_CLOUD_PROJECT,region=process.env.TASKS_REGION||'asia-northeast1',queue=process.env.TASKS_QUEUE||'ai-director',url=process.env.SERVICE_URL,account=process.env.TASK_SERVICE_ACCOUNT}={}){
 return {async enqueue(body,delay=0){
  if(!url||!account)throw new Error('Cloud Tasks worker is not configured.');
  const parent=client.queuePath(project,region,queue),key=createHash('sha256').update(JSON.stringify([body.kind,body.uid,body.id,body.attempt||0])).digest('hex');
  const task={name:parent+'/tasks/'+key,dispatchDeadline:{seconds:1800},scheduleTime:{seconds:Math.floor(Date.now()/1000)+delay},httpRequest:{httpMethod:'POST',url:url+'/internal/tasks',headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify(body)).toString('base64'),oidcToken:{serviceAccountEmail:account,audience:url}}};
  try{await client.createTask({parent,task});}catch(e){if(e.code!==6)throw e;}
 }};
}
export function taskRouter({queue,getStore,getVideo,runScript,verifier=new OAuth2Client(),url=process.env.SERVICE_URL,account=process.env.TASK_SERVICE_ACCOUNT}){
 const router=express.Router();
 router.post('/tasks',express.json({limit:'16kb'}),async(req,res)=>{
  try{const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];if(!token)throw new Error('Missing token');const ticket=await verifier.verifyIdToken({idToken:token,audience:url}),payload=ticket.getPayload();if(payload.email!==account||payload.email_verified!==true)throw new Error('Unexpected worker');}catch{return res.sendStatus(401);}
  const b=req.body;if(!b||!['script','video'].includes(b.kind)||typeof b.uid!=='string'||!b.uid||typeof b.id!=='string'||!/^[\w-]{16,80}$/.test(b.id)||!Number.isInteger(b.attempt||0)||(b.attempt||0)<0)return res.sendStatus(400);
  try{
   if(b.kind==='script')await runScript(b.uid,b.id);
   else{
    const job=await getVideo(b.uid).get(b.id);
    if(job&&!['failed','canceled','submission_unknown'].includes(job.status)&&!(job.status==='completed'&&job.url)&&(b.attempt||0)<240)await queue.enqueue({...b,attempt:(b.attempt||0)+1},30);
    if(job&&(b.attempt||0)>=240&&!(job.status==='completed'&&job.url)&&!['failed','canceled','submission_unknown'].includes(job.status)){job.pollingPaused=true;job.pollError='自动检查窗口已结束，请打开项目刷新状态。';await getStore(b.uid).write('videos/'+job.id+'.json',job);}
    if(job)await linkVideoProject(getStore(b.uid),job);
   }
   res.sendStatus(204);
  }catch(e){console.error('Worker failed',b.kind,b.id,e.code||e.name);res.sendStatus(503);}
 });return router;
}
export async function linkVideoProject(store,job){
 if(!/^[\w-]{16,80}$/.test(job.projectId||'')||!job.shotId)return;
 const key=`projects/${job.projectId}.json`,data=await store.read(key);if(!data)return;
 const shots=data.project.storyboard.flatMap(s=>s.mvinfo),index=shots.findIndex(s=>s.shot_id===job.shotId);if(index<0)return;
 const old=data.director_workspace?.video?.jobs?.[index];
 if(old?.id&&old.id!==job.id&&old.createdAt>job.createdAt)return;
 data.director_workspace??={version:1};data.director_workspace.video??={};data.director_workspace.video.jobs??={};
 data.director_workspace.video.jobs[index]={...job,revision:job.revision||old?.revision||'initial'};
 if(job.url){shots[index].generated_assets??={};shots[index].generated_assets.video={url:job.url,task_id:job.id,storage_path:store.objectPath('videos/'+job.id+'.mp4')};}
 await store.write(key,data);
}
