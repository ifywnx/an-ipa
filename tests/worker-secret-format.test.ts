import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validBackendSecret} from '../src/modules/worker/secret-format';
test('malformed secret values are rejected before HTTP can echo them',()=>{
 const synthetic='sb_secret_'+'a'.repeat(32);
 assert.equal(validBackendSecret(synthetic),true);
 for(const value of ['',synthetic+'\n',synthetic.slice(0,18)+'\n'+synthetic.slice(18),' '+synthetic,synthetic+'\r',synthetic+'秘密','sb_publishable_'+'a'.repeat(32)])assert.equal(validBackendSecret(value),false);
});
