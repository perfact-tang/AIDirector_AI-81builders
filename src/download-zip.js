import {zip} from 'fflate';
export async function downloadZip(items,name,onProgress=()=>{}){
 if(!items.length)throw new Error('还没有已生成的文件。');
 const files={};let total=0;
 for(let i=0;i<items.length;i++){
  onProgress(`正在打包 ${i+1}/${items.length}`);
  const response=await fetch(items[i].url);if(!response.ok)throw new Error(`无法读取 ${items[i].name}，请确认本地服务正在运行。`);
  const bytes=new Uint8Array(await response.arrayBuffer());total+=bytes.length;if(total>512*1024*1024)throw new Error('本次文件超过 512 MB，请分批下载单个文件。');
  files[`${String(i+1).padStart(3,'0')}_${items[i].name.replace(/[^\p{L}\p{N}_.-]/gu,'_')}`]=bytes;
 }
 const bytes=await new Promise((resolve,reject)=>zip(files,{level:0},(error,data)=>error?reject(error):resolve(data)));
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);onProgress(`已打包 ${items.length} 个文件。`);
}
