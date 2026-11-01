import {act,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,it,expect,vi} from 'vitest';
import {QRScanner} from '../../app/ui/qr-scanner';
import {deferred,event,profile} from '../fixtures';
const camera=vi.hoisted(()=>({decode:vi.fn(),stop:vi.fn()}));
vi.mock('@zxing/browser',()=>({BrowserQRCodeReader:class {decodeFromConstraints=camera.decode;}}));
beforeEach(()=>{
  vi.stubGlobal('isSecureContext',true);
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn()}});
  camera.decode.mockReset().mockResolvedValue({stop:camera.stop});
});
it('открывает камеру сразу в простом сканере и освобождает её при выходе',async()=>{
  const view=render(<QRScanner event={event} events={[]} activities={[]} send={vi.fn()} onScan={vi.fn()} simple autoStart/>);
  await waitFor(()=>expect(camera.decode).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button',{name:'Включить камеру'})).not.toBeInTheDocument();
  expect(screen.getByText('Что отмечаем',{selector:'summary'}).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Другие способы').closest('details')).not.toHaveAttribute('open');
  view.unmount();expect(camera.stop).toHaveBeenCalled();
});

it('ждёт выбора события перед автоматическим включением камеры',async()=>{
  const secondEvent={...event,id:'second-event',title:'Второе событие'};
  render(<QRScanner events={[event,secondEvent]} activities={[]} send={vi.fn()} onScan={vi.fn()} simple autoStart/>);
  expect(screen.getByRole('heading',{name:'На какое событие проверяем вход?'})).toBeVisible();
  await act(async()=>{});
  expect(camera.decode).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:new RegExp(secondEvent.title)}));
  await waitFor(()=>expect(camera.decode).toHaveBeenCalledOnce());
  expect(screen.getByRole('button',{name:'Остановить камеру'})).toBeVisible();
});

it.each([
  ['NotAllowedError','Разрешите доступ к камере'],
  ['NotFoundError','Камера не найдена'],
  ['NotReadableError','Камера занята другим приложением'],
])('объясняет %s и позволяет повторно включить камеру',async(name,message)=>{
  camera.decode.mockRejectedValueOnce(new DOMException('private device details',name));
  render(<QRScanner event={event} events={[]} activities={[]} send={vi.fn()} onScan={vi.fn()} simple autoStart/>);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('alert')).not.toHaveTextContent('private device details');
  await userEvent.click(screen.getByRole('button',{name:'Попробовать камеру'}));
  await waitFor(()=>expect(camera.decode).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button',{name:'Остановить камеру'})).toBeVisible();
});

it('останавливает поздно открывшуюся камеру после отмены запроса',async()=>{
  const opened=deferred<{stop:()=>void}>();
  camera.decode.mockReturnValueOnce(opened.promise);
  render(<QRScanner event={event} events={[]} activities={[]} send={vi.fn()} onScan={vi.fn()} simple autoStart/>);
  await waitFor(()=>expect(camera.decode).toHaveBeenCalledOnce());
  await userEvent.click(screen.getByRole('button',{name:'Остановить камеру'}));
  await act(async()=>opened.resolve({stop:camera.stop}));
  expect(camera.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole('button',{name:'Включить камеру'})).toBeEnabled();
});

it('не отправляет повторные кадры QR и игнорирует кадры после остановки',async()=>{
  const response=deferred<unknown>(),send=vi.fn(()=>response.promise),onScan=vi.fn();
  render(<QRScanner event={event} events={[]} activities={[]} send={send} onScan={onScan} simple autoStart/>);
  await waitFor(()=>expect(camera.decode).toHaveBeenCalledOnce());
  const callback=camera.decode.mock.calls[0][2],qr={getText:()=> 'test-qr'};
  act(()=>{callback(qr,undefined,{stop:camera.stop});callback(qr,undefined,{stop:camera.stop});});
  expect(send).toHaveBeenCalledExactlyOnceWith(`events/${event.id}/check-in`,'POST',{qr:'test-qr'});
  await act(async()=>response.resolve({admitted:true,already_checked_in:false,checked_in_at:event.starts_at,attendee:{...profile,activities:[]}}));
  expect(screen.getByRole('heading',{name:'Вход подтверждён'})).toBeVisible();
  act(()=>callback(qr,undefined,{stop:camera.stop}));
  expect(send).toHaveBeenCalledOnce();expect(onScan).toHaveBeenCalledOnce();
});
