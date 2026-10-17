import messages from './translations.json' with {type:'json'};
export const LOCALES=['zh-CN','en','ja'];
const patterns=Object.keys(messages).filter(key=>/\{\d+\}/.test(key)).map(key=>{
 const pieces=key.split(/(\{\d+\})/),slots=[];
 const pattern=pieces.map(piece=>/^\{\d+\}$/.test(piece)?(slots.push(piece),'([\\s\\S]*?)'):piece.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
 return {key,slots,regex:new RegExp('^'+pattern+'$'),weight:key.replace(/\{\d+\}/g,'').length};
}).sort((a,b)=>b.weight-a.weight);
export function translate(value,locale='zh-CN',depth=0){
 if(typeof value!=='string'||locale==='zh-CN'||!['en','ja'].includes(locale)||depth>4)return value;
 const exact=messages[value]?.[locale];if(exact!==undefined)return exact;
 const trimmed=value.trim();if(trimmed!==value&&messages[trimmed]?.[locale]!==undefined)return value.slice(0,value.indexOf(trimmed))+messages[trimmed][locale]+value.slice(value.indexOf(trimmed)+trimmed.length);
 for(const {key,regex,slots} of patterns){const match=regex.exec(value);if(match){const variables=Object.fromEntries(slots.map((slot,i)=>[slot,translate(match[i+1],locale,depth+1)]));return messages[key][locale].replace(/\{\d+\}/g,slot=>variables[slot]);}}
 return value;
}
