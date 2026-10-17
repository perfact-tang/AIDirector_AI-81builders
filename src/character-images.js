const DB_NAME = 'ai-director-assets';
function database() {
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('images');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new Error('无法打开浏览器本地存储。'));
 });
}
export async function imageStore(key,value) {
 const db=await database();
 try { return await new Promise((resolve,reject)=>{
  const transaction=db.transaction('images',value===undefined?'readonly':'readwrite');
  const store=transaction.objectStore('images');
  const request=value===undefined?store.get(key):store.put(value,key);
  transaction.oncomplete=()=>resolve(request.result);
  transaction.onerror=()=>reject(new Error('本地保存失败，请检查浏览器存储空间。'));
  transaction.onabort=()=>reject(new Error('本地保存失败，请检查浏览器存储空间。'));
 }); } finally {db.close();}
}
export const imageKey=(data,index)=>JSON.stringify([data.exported_at,data.project.direction_name,data.project.proposal_id,index,data.project.characters[index].description,data._localId]);
export function readImage(file) {
 return new Promise((resolve,reject)=>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)) return reject(new Error('请选择 PNG、JPG 或 WebP 图片。'));
  if(file.size>10*1024*1024) return reject(new Error('图片不能超过 10 MB。'));
  const reader=new FileReader(); reader.onerror=()=>reject(new Error('图片读取失败。'));
  reader.onload=()=>{const image=new Image();image.onload=()=>resolve(reader.result);image.onerror=()=>reject(new Error('无法识别此图片，请重新选择。'));image.src=reader.result;};
  reader.readAsDataURL(file);
 });
}
