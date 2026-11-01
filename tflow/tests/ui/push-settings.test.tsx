import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushSettings } from "../../app/ui/push-settings";

const key=btoa(String.fromCharCode(...new Uint8Array(65))).replace(/=/g, "");
afterEach(()=>vi.unstubAllGlobals());
function support(permission: NotificationPermission = "default") {
  const requestPermission=vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("isSecureContext", true);vi.stubGlobal("PushManager", function(){});
  vi.stubGlobal("Notification", {permission,requestPermission});
  const subscription={ options: {applicationServerKey:new Uint8Array(65).buffer},toJSON:()=>({endpoint:"https://provider.test/private",keys:{auth:"secret"}}),unsubscribe:vi.fn().mockResolvedValue(true) };
  const registration={pushManager:{getSubscription:vi.fn().mockResolvedValue(null),subscribe:vi.fn().mockResolvedValue(subscription)}};
  const register=vi.fn().mockResolvedValue(registration);
  Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{register,ready:Promise.resolve(registration),getRegistration:vi.fn().mockResolvedValue(registration)}});
  return {requestPermission,register,registration,subscription};
}
describe("подключение браузерных уведомлений",()=>{
  it("спрашивает разрешение только после клика и сохраняет настоящую подписку",async()=>{
    const s=support(),send=vi.fn().mockResolvedValue({configured:true,ready:true,deviceEnabled:false,publicKey:key});
    render(<PushSettings send={send}/>);
    const enable=await screen.findByRole("button",{name:"Включить push"});
    expect(s.requestPermission).not.toHaveBeenCalled();expect(s.register).not.toHaveBeenCalled();
    await userEvent.click(enable);
    await screen.findByRole("button",{name:"Отключить на устройстве"});
    expect(s.requestPermission).toHaveBeenCalledOnce();
    expect(send).toHaveBeenLastCalledWith("push/subscriptions","POST",s.subscription.toJSON());
    expect(s.register).toHaveBeenCalledWith("/push-sw.js",{scope:"/",updateViaCache:"none"});
  });
  it("отказ не пытается подписать пользователя и объясняет как включить позже",async()=>{
    const s=support();s.requestPermission.mockResolvedValue("denied");
    const send=vi.fn().mockResolvedValue({configured:true,ready:true,deviceEnabled:false,publicKey:key});
    render(<PushSettings send={send}/>);await userEvent.click(await screen.findByRole("button",{name:"Включить push"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Разрешите уведомления");expect(s.register).not.toHaveBeenCalled();
  });
  it("отключает только текущую серверную привязку и проверяет очередь тестом",async()=>{
    const s=support();s.registration.pushManager.getSubscription.mockResolvedValue(s.subscription);
    const send=vi.fn().mockResolvedValue({configured:true,ready:true,deviceEnabled:true,publicKey:key});
    render(<PushSettings send={send}/>);
    await userEvent.click(await screen.findByRole("button",{name:"Проверить доставку"}));
    await waitFor(()=>expect(send).toHaveBeenCalledWith("push/test","POST",{}));
    expect(screen.getByRole("status")).toHaveTextContent("в очередь");
    await userEvent.click(screen.getByRole("button",{name:"Отключить на устройстве"}));
    await screen.findByRole("button",{name:"Включить push"});expect(s.subscription.unsubscribe).toHaveBeenCalledOnce();
  });
});
