import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,it,expect,vi} from 'vitest';
import {ProgramTimeline} from '../../app/ui/program-timeline';
import type {Activity} from '../../lib/types';
import {event} from '../fixtures';
const first={id:'one',title:'Первый доклад',room_id:'main',room_name:'Главный зал',event_id:event.id,starts_at:event.starts_at,ends_at:event.starts_at+30*60000,updated_at:1,capacity:10,taken:0} as Activity;
const second={...first,id:'two',title:'Второй доклад',starts_at:event.starts_at+60*60000,ends_at:event.starts_at+90*60000};
beforeEach(()=>{vi.stubGlobal('PointerEvent',class extends MouseEvent {pointerId=1;isPrimary=true;});});
function mount(){const action=vi.fn().mockResolvedValue({undo:'signed-proof',created_ids:[]}),select=vi.fn();const {container}=render(<ProgramTimeline event={event} activities={[first,second]} onEdit={vi.fn()} onSelect={select} onReschedule={vi.fn()} onMontage={action}/>);vi.spyOn(container.querySelector('.timeline-canvas')!,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:600,height:300,right:600,bottom:300,x:0,y:0,toJSON(){}});return {action,select};}
it('сохраняет перенос сразу, подавляет синтетический клик и оставляет обычное нажатие рабочим',async()=>{
 const {action,select}=mount(),block=screen.getByRole('button',{name:/Первый доклад ·/});
 fireEvent.pointerDown(block,{button:0,clientX:50});fireEvent.pointerMove(block,{clientX:200});fireEvent.pointerUp(block,{clientX:200});fireEvent.click(block,{detail:0});
 await waitFor(()=>expect(action).toHaveBeenCalledWith(expect.objectContaining({operation:'move',activity_id:first.id,starts_at:first.starts_at+30*60000})));
 expect(select).not.toHaveBeenCalled();expect(screen.queryByRole('form')).not.toBeInTheDocument();
 fireEvent.pointerDown(block,{button:0,clientX:200});fireEvent.pointerUp(block,{clientX:200});fireEvent.click(block,{detail:1});expect(select).toHaveBeenCalledWith(first);
});
it('открывает монтаж правой кнопкой, разрезает в указанном месте и отменяет без диалогов',async()=>{
 const {action}=mount();const user=userEvent.setup();
 fireEvent.contextMenu(screen.getByRole('button',{name:/Первый доклад ·/}),{clientX:75,clientY:100});
 const menu=screen.getByRole('menu',{name:'Монтаж программы'});const cut=within(menu).getByRole('menuitem',{name:/Разрезать здесь · 10:15/});
 await user.click(cut);await waitFor(()=>expect(action).toHaveBeenCalledWith({operation:'split',activity_id:first.id,at:first.starts_at+15*60000}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Отменить'}));
 expect(action).toHaveBeenLastCalledWith({operation:'undo',undo:'signed-proof'});
});
it('вырезает в буфер и вставляет внутрь другого пункта через контекстное меню',async()=>{
 const {action}=mount();const user=userEvent.setup();
 fireEvent.contextMenu(screen.getByRole('button',{name:/Первый доклад ·/}),{clientX:75,clientY:100});await user.click(screen.getByRole('menuitem',{name:/^Вырезать/}));expect(action).not.toHaveBeenCalled();
 fireEvent.contextMenu(screen.getByRole('button',{name:/Второй доклад ·/}),{clientX:375,clientY:100});await user.click(screen.getByRole('menuitem',{name:'Вставить внутрь'}));
 await waitFor(()=>expect(action).toHaveBeenCalledWith({operation:'insert',activity_id:first.id,target_id:second.id,position:'inside',at:second.starts_at+15*60000,room_id:undefined}));
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('не перемещает пункт от дрожания мыши и закрывает меню клавишей Escape с возвратом фокуса',async()=>{
 const {action}=mount(),block=screen.getByRole('button',{name:/Первый доклад ·/});
 fireEvent.pointerDown(block,{button:0,clientX:50});fireEvent.pointerMove(block,{clientX:53});fireEvent.pointerUp(block,{clientX:53});expect(action).not.toHaveBeenCalled();
 fireEvent.contextMenu(block,{clientX:75,clientY:100});expect(screen.getByRole('menuitem',{name:/^Вырезать/})).toHaveFocus();await userEvent.keyboard('{Escape}');expect(screen.queryByRole('menu')).not.toBeInTheDocument();expect(block).toHaveFocus();
});

it('открывает меню с клавиатуры и позволяет вставить копию после исходного пункта',async()=>{
 const {action}=mount(),block=screen.getByRole('button',{name:/Первый доклад ·/}),user=userEvent.setup();
 block.focus();fireEvent.keyDown(block,{key:'F10',shiftKey:true});await user.click(screen.getByRole('menuitem',{name:/^Копировать/}));
 fireEvent.keyDown(block,{key:'F10',shiftKey:true});await user.click(screen.getByRole('menuitem',{name:'Вставить после'}));
 await waitFor(()=>expect(action).toHaveBeenCalledWith(expect.objectContaining({operation:'copy',activity_id:first.id,target_id:first.id,position:'after'})));
});

it('не съедает настоящий Alt-клик после переноса, у которого не было завершающего click',async()=>{
 const {action}=mount(),block=screen.getByRole('button',{name:/Первый доклад ·/});
 fireEvent.pointerDown(block,{button:0,clientX:50});fireEvent.pointerMove(block,{clientX:200});fireEvent.pointerUp(block,{clientX:200});
 await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));await waitFor(()=>expect(block).toBeEnabled());
 fireEvent.pointerDown(block,{button:0,clientX:75,altKey:true});fireEvent.click(block,{clientX:75,altKey:true,detail:1});
 await waitFor(()=>expect(action).toHaveBeenLastCalledWith({operation:'split',activity_id:first.id,at:first.starts_at+15*60000}));
});
