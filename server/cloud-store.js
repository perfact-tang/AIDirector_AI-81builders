import {mkdir} from 'node:fs/promises';
import path from 'node:path';
export const ownerKey=uid=>Buffer.from(uid).toString('base64url');
export function createCloudStore(bucket,uid){
 if(typeof uid!=='string'||!uid)throw new Error('Missing authenticated owner');
 const prefix=`ai-director/users/${ownerKey(uid)}/`;
 const file=key=>{if(!/^[\w./-]+$/.test(key)||key.includes('..')||key.startsWith('/'))throw new Error('Invalid object path');return bucket.file(prefix+key);};
 return {prefix,
  async read(key){try{return JSON.parse((await file(key).download())[0].toString('utf8'));}catch(e){if(e.code===404)return null;throw e;}},
  async write(key,value,{create=false}={}){await file(key).save(JSON.stringify(value),{resumable:false,contentType:'application/json',metadata:{cacheControl:'private, no-store'},...(create?{preconditionOpts:{ifGenerationMatch:0}}:{})});},
  async bytes(key,bytes,contentType){await file(key).save(bytes,{resumable:false,contentType,metadata:{cacheControl:'private, no-store'}});},
  async upload(key,local,contentType){await bucket.upload(local,{destination:prefix+key,resumable:false,metadata:{contentType,cacheControl:'private, no-store'}});},
  async download(key,local){await mkdir(path.dirname(local),{recursive:true});await file(key).download({destination:local});return local;},
  async buffer(key){return (await file(key).download())[0];},
  async list(directory){const [files]=await bucket.getFiles({prefix:prefix+directory,maxResults:1000,autoPaginate:false});return files.map(f=>f.name.slice(prefix.length));},
  objectPath:key=>prefix+key,
 };
}
