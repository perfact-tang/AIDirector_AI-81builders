import {getApps,initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getStorage} from 'firebase-admin/storage';
export const cloudEnabled=()=>process.env.CLOUD_MODE==='true'||!!process.env.K_SERVICE;
export function firebaseServices(){
 if(!process.env.FIREBASE_STORAGE_BUCKET||!process.env.GOOGLE_CLOUD_PROJECT)throw new Error('Firebase project or Storage bucket is missing.');
 const app=getApps()[0]||initializeApp({credential:applicationDefault(),projectId:process.env.GOOGLE_CLOUD_PROJECT,storageBucket:process.env.FIREBASE_STORAGE_BUCKET});
 return {auth:getAuth(app),bucket:getStorage(app).bucket()};
}
export function publicFirebaseConfig(){
 try{const config=JSON.parse(process.env.FIREBASE_WEB_CONFIG||'{}');return {apiKey:config.apiKey,authDomain:config.authDomain,projectId:config.projectId,appId:config.appId,storageBucket:config.storageBucket,messagingSenderId:config.messagingSenderId};}catch{throw new Error('FIREBASE_WEB_CONFIG is invalid.');}
}
