import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventFlows } from "../../app/ui/event-flows";
import { QRScanner } from "../../app/ui/qr-scanner";
import { ActivityCard } from "../../app/ui/activity-program";
import { NotificationCenter } from "../../app/ui/notification-center";
import { event, profile, notice } from "../fixtures";

import type { Activity } from "../../lib/types";
const activity: Activity = {id:"flow-one",event_id:event.id,room_id:"room-one",room_name:"Зал 1",title:"Лекция A",description:"",speaker:"",starts_at:event.starts_at,ends_at:event.ends_at,capacity:10,taken:1,registered:0,waiting_count:0,waitlisted:0,waitlist_position:1,updated_at:1};
const admitted = {admitted:true,already_checked_in:false,checked_in_at:event.starts_at,attendee:{id:profile.id,name:profile.name,activities:[]}};

describe("ясные сценарии участия", () => {
  it("сканер явно различает вход на мероприятие и посещение конкретного флоу", async () => {
    const send=vi.fn().mockResolvedValue(admitted), user=userEvent.setup();
    render(<QRScanner event={event} events={[]} activities={[activity]} send={send} onScan={vi.fn()}/>);
    await user.selectOptions(screen.getByRole("combobox",{name:"Что отмечаем"}),activity.id);
    await user.click(screen.getByText("Проверить по ссылке"));
    await user.type(screen.getByLabelText("Ссылка или код из QR"),"a-person-qr");
    await user.click(screen.getByRole("button",{name:"Проверить и отметить"}));
    expect(await screen.findByRole("heading",{name:"Посещение флоу подтверждено"})).toBeVisible();
    expect(send).toHaveBeenCalledWith(`events/${event.id}/check-in`,"POST",{qr:"a-person-qr",activity_id:activity.id});
    await user.selectOptions(screen.getByRole("combobox",{name:"Что отмечаем"}),"");
    expect(screen.queryByRole("heading",{name:"Посещение флоу подтверждено"})).not.toBeInTheDocument();
  });

  it("показывает причину приостановки очереди и объясняет сохранение позиции", () => {
    const conflict={...activity,id:"busy",title:"Другая лекция"};
    render(<ActivityCard activity={{...activity,waitlisted:1,waitlist_state:"time_conflict",registered:0}} schedule={[conflict]} organizer={false} pending={false} onAction={vi.fn()}/>);
    expect(screen.getByText(/Очередь приостановлена/)).toBeVisible();
    expect(screen.getByText(/следующий подходящий участник/)).toBeVisible();
    expect(screen.getByText(/Другая лекция/)).toBeVisible();
    expect(screen.getByRole("button",{name:"Покинуть очередь"})).toBeEnabled();
  });

  it("показывает подтвержденное посещение отдельно от регистрации", () => {
    render(<ActivityCard activity={{...activity,attended:true,registered:1}} schedule={[]} organizer={false} pending={false} onAction={vi.fn()}/>);
    expect(screen.getByText("Посещение подтверждено")).toBeVisible();
    expect(screen.getByText("Вы записаны")).toBeVisible();
  });

  it("после перехода к флоу автообновление не забирает фокус у пользователя", async () => {
    const user=userEvent.setup();
    const props={focusActivityId:activity.id,activities:[activity],schedule:[],organizer:false,pending:false,onAction:vi.fn()};
    const view=render(<EventFlows {...props}/>);
    expect(document.activeElement).toHaveAttribute("id",`flow-${activity.id}`);
    const search=screen.getByRole("textbox",{name:"Найти активность"});
    await user.click(search);
    view.rerender(<EventFlows {...props} activities={[{...activity,updated_at:2}]}/>);
    expect(search).toHaveFocus();
  });

  it("напоминание открывает конкретную активность после сохранения прочтения", async () => {
    const onOpen=vi.fn(), user=userEvent.setup();
    const send=vi.fn().mockResolvedValueOnce({items:[notice("reminder",{kind:"activity_reminder",activity_id:activity.id})],next_cursor:null}).mockResolvedValue({ok:true});
    render(<NotificationCenter send={send} unreadCount={1} revision="1" onChange={vi.fn().mockResolvedValue(undefined)} onOpen={onOpen}/>);
    expect(await screen.findByRole("heading",{name:"Скоро начнётся активность"})).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Открыть событие"}));
    await waitFor(()=>expect(onOpen).toHaveBeenCalledWith("event-one",activity.id));
    expect(send).toHaveBeenCalledWith("notifications/reminder","PATCH",{});
  });
});
