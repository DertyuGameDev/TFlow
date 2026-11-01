import {render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {QRScanner} from '../../app/ui/qr-scanner';
import {event} from '../fixtures';
const camera=vi.hoisted(()=>({decode:vi.fn(),stop:vi.fn()}));
vi.mock('@zxing/browser',()=>({BrowserQRCodeReader:class {decodeFromConstraints=camera.decode;}}));
it('открывает камеру сразу в простом сканере и освобождает её при выходе',async()=>{
  vi.stubGlobal('isSecureContext',true);
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn()}});
  camera.decode.mockResolvedValue({stop:camera.stop});
  const view=render(<QRScanner event={event} events={[]} activities={[]} send={vi.fn()} onScan={vi.fn()} simple autoStart/>);
  await waitFor(()=>expect(camera.decode).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button',{name:'Включить камеру'})).not.toBeInTheDocument();
  expect(screen.getByText('Что отмечаем',{selector:'summary'}).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Другие способы').closest('details')).not.toHaveAttribute('open');
  view.unmount();expect(camera.stop).toHaveBeenCalled();
});
