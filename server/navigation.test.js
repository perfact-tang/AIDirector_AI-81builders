import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreJob} from '../src/navigation-state.js';
test('reloading a specific cloud/local project never restores an unrelated previous job',()=>{
 const storage={getItem:()=> 'previous-job'};
 assert.equal(restoreJob({pathname:'/project',search:'?cloud=chosen-cloud-project'},storage),null);
 assert.equal(restoreJob({pathname:'/project',search:'?local=chosen-local-project'},storage),null);
 assert.equal(restoreJob({pathname:'/',search:''},storage),null);
 assert.equal(restoreJob({pathname:'/project',search:'?job=explicit-job'},storage).id,'explicit-job');
 assert.equal(restoreJob({pathname:'/processing',search:''},storage).id,'previous-job');
});
