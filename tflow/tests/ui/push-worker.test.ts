import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker(response: unknown, fail=false) {
  const handlers:Record<string,(event:any)=>void>={};
  const show=vi.fn().mockResolvedValue(undefined),post=vi.fn(),open=vi.fn();
  const fetch=vi.fn().mockResolvedValue({ok:!fail,headers:{get:()=>"application/json"},json:async()=>response});
  const self={addEventListener:(name:string,fn:any)=>handlers[name]=fn,skipWaiting:vi.fn(),location:{origin:"https://tflow.test"},
    registration:{showNotification:show},clients:{claim:vi.fn(),matchAll:async()=>[{postMessage:post,url:"https://tflow.test/",navigate:open,focus:vi.fn()}],openWindow:open}};
  runInNewContext(readFileSync(process.cwd()+"/public/push-sw.js","utf8"),{self,fetch,AbortController,setTimeout,clearTimeout,URL});
  async function fire(name:string,event:any){let promise;handlers[name]({...event,waitUntil:(p:Promise<void>)=>promise=p});await promise;}
  return {handlers,show,fetch,post,open,fire};
}
describe("Web Push service worker",()=>{
  it("получает личные детали под текущей сессией и не кэширует приложение",async()=>{
    const w=worker({id:"notice",title:"Перенос",message:"Время изменилось",event_id:"event",activity_id:"activity"});
    await w.fire("push",{data:{json:()=>({noticeId:"notice"})}});
    expect(w.fetch).toHaveBeenCalledWith("/api/notifications/notice",expect.objectContaining({credentials:"same-origin",cache:"no-store",redirect:"error"}));
    expect(w.show).toHaveBeenCalledWith("Перенос",expect.objectContaining({body:"Время изменилось",tag:"notice",data:{url:"/#event/event/activity"}}));
    expect(w.post).toHaveBeenCalledWith({type:"tflow-notifications-changed"});expect(w.handlers.fetch).toBeUndefined();
  });
  it("при истёкшей или чужой сессии не показывает содержание старого аккаунта",async()=>{
    const w=worker({message:"Чужое содержимое"},true);await w.fire("push",{data:{json:()=>({noticeId:"private"})}});
    expect(w.show.mock.calls[0][1].body).toContain("Войдите в аккаунт");expect(JSON.stringify(w.show.mock.calls)).not.toContain("Чужое");
  });
  it("не разрешает переход по внешней ссылке из уведомления",async()=>{
    const w=worker({});await w.fire("notificationclick",{notification:{close:vi.fn(),data:{url:"https://evil.test/"}}});expect(w.open).not.toHaveBeenCalled();
  });
});
