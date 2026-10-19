export function restoreJob(location,storage){
 try{
  const params=new URLSearchParams(location.search);
  // Explicit cloud/local project routes must never be replaced by an older job.
  if(params.has('cloud')||params.has('local'))return null;
  const id=params.get('job')||(['/processing','/project'].includes(location.pathname)?storage.getItem('director-job'):null);
  return id?{id,status:'running',stage:'正在恢复任务进度'}:null;
 }catch{return null;}
}
