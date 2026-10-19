import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
export function fakeBucket(){
 const objects=new Map();const missing=()=>Object.assign(new Error('Not found'),{code:404});
 return {objects,file(name){return {name,async save(bytes,options={}){if(options.preconditionOpts?.ifGenerationMatch===0&&objects.has(name))throw Object.assign(new Error('Already exists'),{code:412});objects.set(name,Buffer.from(bytes));},async download({destination}={}){if(!objects.has(name))throw missing();const bytes=Buffer.from(objects.get(name));if(destination){await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);}return [bytes];}};},async upload(local,{destination}){objects.set(destination,await readFile(local));},async getFiles({prefix}){return [[...objects.keys()].filter(name=>name.startsWith(prefix)).map(name=>({name}))];}};
}
