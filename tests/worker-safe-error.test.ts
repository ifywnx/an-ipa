import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeWorkerError} from '../src/modules/worker/safe-error';
test('durable diagnostics preserve only reviewed error codes',()=>{
 assert.equal(safeWorkerError(new Error('DIAGNOSTIC_PUBLIC_OBJECT'),'FAILED'),'DIAGNOSTIC_PUBLIC_OBJECT');
 for(const value of [new Error('Headers.append: synthetic credential'),new Error('DIAGNOSTIC_PUBLIC_OBJECT secret'),{message:'DIAGNOSTIC_PUBLIC_OBJECT'},null])assert.equal(safeWorkerError(value,'FAILED'),'FAILED');
});
