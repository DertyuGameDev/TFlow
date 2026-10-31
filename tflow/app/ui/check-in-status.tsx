import { CircleCheck } from "lucide-react";
import type { FlowEvent } from "../../lib/types";
import "../check-in-status.css";

export function CheckInStatus({ event }: { event: Pick<FlowEvent, "id" | "title"> }) {
  return (
    <div className="participant-entry-status" role="status" aria-label="Вход в мероприятие подтверждён">
      <CircleCheck size={22} aria-hidden="true" />
      <div>
        <strong>Вы вошли в мероприятие</strong>
        <a href={`#event/${event.id}`}>{event.title}</a>
      </div>
    </div>
  );
}
