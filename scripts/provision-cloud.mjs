// Scoped provisioning for this application. Existing Firebase users and rules stay intact.
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
const project='vibecodingjapan',region='asia-northeast1',account=`ai-director-run@${project}.iam.gserviceaccount.com`,bucket='vibecodingjapan.firebasestorage.app';
const run=(args,options={})=>execFileSync('gcloud',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
function ensure(describe,create){try{run(describe);}catch{run(create);}}
ensure(['iam','service-accounts','describe',account,'--project',project],['iam','service-accounts','create','ai-director-run','--project',project,'--display-name','AI Director Cloud Run','--quiet']);
run(['services','enable','cloudtasks.googleapis.com','--project',project,'--quiet']);
ensure(['tasks','queues','describe','ai-director','--location',region,'--project',project],['tasks','queues','create','ai-director','--location',region,'--project',project,'--max-concurrent-dispatches=2','--max-dispatches-per-second=2','--max-attempts=5','--min-backoff=30s','--max-backoff=300s','--quiet']);
run(['tasks','queues','add-iam-policy-binding','ai-director','--location',region,'--project',project,'--member',`serviceAccount:${account}`,'--role','roles/cloudtasks.enqueuer','--quiet']);
run(['iam','service-accounts','add-iam-policy-binding',account,'--project',project,'--member',`serviceAccount:${account}`,'--role','roles/iam.serviceAccountUser','--quiet']);
const roleFile='/tmp/ai-director-auth-role.json';writeFileSync(roleFile,JSON.stringify({title:'AI Director session authentication',description:'Verify existing users and create Firebase session cookies',stage:'GA',includedPermissions:['firebaseauth.users.get','firebaseauth.users.createSession']}));
try{run(['iam','roles','describe','aiDirectorSession','--project',project]);run(['iam','roles','update','aiDirectorSession','--project',project,'--file',roleFile,'--quiet']);}catch{run(['iam','roles','create','aiDirectorSession','--project',project,'--file',roleFile,'--quiet']);}
run(['projects','add-iam-policy-binding',project,'--member',`serviceAccount:${account}`,'--role',`projects/${project}/roles/aiDirectorSession`,'--condition=None','--quiet']);
run(['storage','buckets','add-iam-policy-binding',`gs://${bucket}`,'--member',`serviceAccount:${account}`,'--role','roles/storage.objectAdmin','--condition',`expression=resource.name.startsWith('projects/_/buckets/${bucket}/objects/ai-director/') || resource.name == 'projects/_/buckets/${bucket}',title=ai-director-only`,'--quiet']);
ensure(['artifacts','repositories','describe','ai-director','--location',region,'--project',project],['artifacts','repositories','create','ai-director','--repository-format=docker','--location',region,'--project',project,'--description','AI Director container images','--quiet']);
ensure(['secrets','describe','ai-director-aiand-key','--project',project],['secrets','create','ai-director-aiand-key','--replication-policy=automatic','--project',project,'--quiet']);
const versions=run(['secrets','versions','list','ai-director-aiand-key','--project',project,'--filter=state:ENABLED','--format=value(name)']).trim();
if(!versions){process.loadEnvFile('.env');if(!process.env.AIAND_API_KEY)throw new Error('AIAND_API_KEY is missing');run(['secrets','versions','add','ai-director-aiand-key','--project',project,'--data-file=-','--quiet'],{input:process.env.AIAND_API_KEY});}
run(['secrets','add-iam-policy-binding','ai-director-aiand-key','--project',project,'--member',`serviceAccount:${account}`,'--role','roles/secretmanager.secretAccessor','--quiet']);
const firebase=JSON.parse(readFileSync('/tmp/ai-director-firebase-config.json','utf8')).result.sdkConfig;
writeFileSync('/tmp/ai-director-cloud-env.json',JSON.stringify({NODE_ENV:'production',CLOUD_MODE:'true',GOOGLE_CLOUD_PROJECT:project,FIREBASE_STORAGE_BUCKET:bucket,FIREBASE_WEB_CONFIG:JSON.stringify(firebase),FIREBASE_GOOGLE_LOGIN:'false',TASKS_REGION:region,TASKS_QUEUE:'ai-director',TASK_SERVICE_ACCOUNT:account,SERVICE_URL:'https://ai-director-153532166169.asia-northeast1.run.app'},null,2));
console.log('AI Director: runtime account, Storage prefix, Auth role, Cloud Tasks queue, repository and Secret ready.');
