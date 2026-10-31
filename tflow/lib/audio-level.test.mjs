import assert from 'node:assert/strict';
import { test } from 'node:test';
import { microphoneSignal, microphoneError } from './audio-level.ts';

test('turning microphone on in silence does not invent speech',()=>{
  assert.deepEqual(microphoneSignal(true,0,false),{active:false,volume:0,bars:0});
});
test('server-reported speech lights the indicator even at a quiet level',()=>{
  assert.deepEqual(microphoneSignal(true,.01,true),{active:true,volume:.01,bars:1});
  assert.equal(microphoneSignal(true,.7,true).bars,4);
});
test('muting clears residual level and speaking status immediately',()=>{
  assert.deepEqual(microphoneSignal(false,.8,true),{active:false,volume:0,bars:0});
});
test('meter clamps invalid levels and never exceeds five bars',()=>{
  for(const value of [NaN,Infinity,-1]) assert.equal(microphoneSignal(true,value,false).volume,0);
  assert.equal(microphoneSignal(true,8,true).bars,5);
});
test('permission denial and missing or busy devices explain the next action',()=>{
  assert.match(microphoneError({name:'NotAllowedError'}),/Разрешите доступ/);
  assert.match(microphoneError({name:'NotFoundError'}),/не найден/);
  assert.match(microphoneError({name:'NotReadableError'}),/другой микрофон/);
});
