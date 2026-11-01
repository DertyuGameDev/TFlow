import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,it,expect,vi} from 'vitest';
import HttpWebinar from '../../app/ui/http-webinar';
import {event} from '../fixtures';
import type {Activity} from '../../lib/types';
const source=vi.hoisted(()=>({dispose:vi.fn(),stop:vi.fn()}));
vi.mock('../../lib/http-broadcast',async importOriginal=>({...await importOriginal<typeof import('../../lib/http-broadcast')>(),
  recordingMime:()=> 'video/webm',
  BroadcastCapture:class {stream={};dispose=source.dispose;},
  BroadcastUpload:class {stop=source.stop;},
}));
const activity={id:'activity-one',title:'Доклад',starts_at:event.starts_at,ends_at:event.ends_at} as Activity;
const idle={host:true,active:false,configured:true,ended:false,published:true,session:null,can_start:true};
beforeEach(()=>{sessionStorage.clear();source.dispose.mockClear();source.stop.mockClear();vi.stubGlobal('isSecureContext',true);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{}});});
it('opens a separate studio and focuses the existing one without navigating or interrupting it',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>idle})));
  const popup={location:{href:'about:blank',replace:vi.fn()},focus:vi.fn()};
  vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window);
  const view=render(<HttpWebinar event={event} activity={activity} initialStatus={idle}/>);
  expect(screen.queryByRole('button',{name:'Начать эфир'})).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Открыть студию'}));
  expect(window.open).toHaveBeenCalledWith('',`tflow-studio-${activity.id}`,expect.any(String));
  expect(popup.location.replace).toHaveBeenCalledWith(`/#studio/${event.id}/${activity.id}`);
  popup.location.href='https://tflow.test/#studio';
  await userEvent.click(screen.getByRole('button',{name:'Открыть студию'}));
  expect(popup.location.replace).toHaveBeenCalledTimes(1);expect(popup.focus).toHaveBeenCalledTimes(2);view.unmount();
});
it('retains the broadcast and publisher proof on refresh, resumes the same room, and ends only explicitly',async()=>{
  let status={...idle,active:false,session:null as string|null,can_resume:false};
  const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
    const data=options?.body ? JSON.parse(String(options.body)):{};
    if(data.operation==='start'||data.operation==='resume') {status={...status,active:true,session:'room-one',can_resume:true};return {ok:true,json:async()=>({session:'room-one',publisher:data.operation==='resume'?'rotated-proof':'first-proof'})};}
    if(data.operation==='end')status={...status,active:false};
    return {ok:true,json:async()=>url.endsWith('/chat')?{messages:[]}:status};
  });vi.stubGlobal('fetch',fetcher);
  const view=render(<HttpWebinar studio event={event} activity={activity} initialStatus={idle}/>);
  await userEvent.click(screen.getByRole('button',{name:'Начать эфир'}));
  await waitFor(()=>expect(screen.getByText('● Вы в эфире')).toBeVisible());
  window.dispatchEvent(new Event('pagehide'));view.unmount();
  expect(fetcher.mock.calls.some(([,o])=>String(o?.body).includes('"end"'))).toBe(false);
  expect(source.stop).toHaveBeenCalled();expect(source.dispose).toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(`tflow-publisher:${event.id}:${activity.id}`)!)).toEqual({session:'room-one',publisher:'first-proof'});
  const restored=render(<HttpWebinar studio event={event} activity={activity} initialStatus={status}/>);
  await userEvent.click(screen.getByRole('button',{name:'Восстановить трансляцию'}));
  expect(fetcher.mock.calls.some(([,o])=>{const b=String(o?.body);return b.includes('"resume"')&&b.includes('first-proof')})).toBe(true);
  await userEvent.click(screen.getByRole('button',{name:'Завершить эфир'}));
  await userEvent.click(screen.getByRole('button',{name:'Да, завершить эфир'}));
  await waitFor(()=>expect(sessionStorage.getItem(`tflow-publisher:${event.id}:${activity.id}`)).toBeNull());restored.unmount();
});
