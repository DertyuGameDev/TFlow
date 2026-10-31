import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishScreenShare, screenShareUnavailable, screenShareError } from './screen-share.ts';

const browser = {secure:true,supported:true,allowedByPolicy:true,embedded:false};
test('normal browsers and authorized iframes can share, restricted previews cannot',()=>{
  assert.equal(screenShareUnavailable(browser),null);
  assert.equal(screenShareUnavailable({...browser,embedded:true}),null);
  assert.match(screenShareUnavailable({...browser,allowedByPolicy:false}),/Встроенное окно/);
  assert.match(screenShareUnavailable({...browser,supported:false}),/не поддерживает/);
  assert.match(screenShareUnavailable({...browser,secure:false}),/HTTPS/);
});
test('cancel, OS denial, missing gesture and unsupported preview give actionable messages',()=>{
  assert.match(screenShareError({name:'NotAllowedError'},browser),/отменён/);
  assert.match(screenShareError({name:'NotAllowedError'},{...browser,embedded:true}),/обычном браузере/);
  assert.match(screenShareError({name:'NotReadableError'},browser),/разрешение на запись/);
  assert.match(screenShareError({name:'InvalidStateError'},browser),/активную вкладку/);
  assert.match(screenShareError({name:'NotSupportedError'},browser),/обычном браузере/);
});
const track = () => ({stopped:false,stop(){this.stopped=true;}});
function environment(overrides={}) {
  return {capture:async()=>[track()],publish:async()=>{},unpublish:async()=>{},isCurrent:()=>true,...overrides};
}
test('capture starts synchronously in the click stack; successful publication keeps tracks alive',async()=>{
  let capturing=false;
  const video=track();
  const pending=publishScreenShare(environment({capture:()=>{capturing=true;return Promise.resolve([video]);}}));
  assert.equal(capturing,true);
  assert.equal(await pending,true);
  assert.equal(video.stopped,false);
});
test('cancelled browser chooser does not publish anything',async()=>{
  let published=0;
  await assert.rejects(publishScreenShare(environment({capture:async()=>{throw new DOMException('cancel','NotAllowedError');},publish:async()=>published++})),{name:'NotAllowedError'});
  assert.equal(published,0);
});
test('capture resolved after leaving is stopped without publication',async()=>{
  const video=track();let resolveCapture,published=0,current=true;
  const pending=publishScreenShare(environment({capture:()=>new Promise(resolve=>resolveCapture=resolve),publish:async()=>published++,isCurrent:()=>current}));
  current=false;resolveCapture([video]);
  assert.equal(await pending,false);
  assert.equal(published,0);
  assert.equal(video.stopped,true);
});
test('disconnect during publication removes the published screen and stops capture',async()=>{
  const video=track();let current=true,removed=0;
  assert.equal(await publishScreenShare(environment({capture:async()=>[video],publish:async()=>{current=false;},unpublish:async()=>removed++,isCurrent:()=>current})),false);
  assert.equal(removed,1);assert.equal(video.stopped,true);
});
test('partial publication failure releases all tracks even if unpublishing fails',async()=>{
  const video=track(),audio=track();let count=0;
  await assert.rejects(publishScreenShare(environment({capture:async()=>[video,audio],publish:async()=>{if(++count===2)throw new Error('network');},unpublish:()=>{throw new Error('offline');}})),/network/);
  assert.equal(video.stopped,true);assert.equal(audio.stopped,true);
});
test('empty capture cannot be reported as a working screen share',async()=>{
  await assert.rejects(publishScreenShare(environment({capture:async()=>[]})),/no tracks/);
});
