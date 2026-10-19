import {readFile} from 'node:fs/promises';
import {validateAppProject} from './project_contract.mjs';
try {const errors=validateAppProject(JSON.parse(await readFile(process.argv[2],'utf8')));if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('VALID');}catch(e){console.error(e.message);process.exitCode=1;}
