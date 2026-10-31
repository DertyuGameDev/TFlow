import type { ComponentProps } from "react";
import { Video } from "lucide-react";
import { ActivityProgram } from "./activity-program";
import type { FlowEvent } from "../../lib/types";
import { webinarPath } from "../../lib/webinars";

export function WebinarChannels({ event, ...program }: Omit<ComponentProps<typeof ActivityProgram>, "personal"> & { event: FlowEvent }) {
  return <section className="webinar-channels" aria-label="Онлайн-флоу мероприятия">
    <h2>Выберите онлайн-флоу</h2>
    <p>Эфиры могут идти одновременно. У каждого флоу отдельные видео, звук и чат.
      {program.organizer ? " Откройте студии параллельных эфиров в разных вкладках." : " Запишитесь на нужный флоу и войдите в его вебинар."}</p>
    <ActivityProgram {...program} />
    <a className="button secondary" href={webinarPath(event.id, "general")}>
      <Video size={17} />{program.organizer ? "Студия общего эфира мероприятия" : "Общий эфир мероприятия"}
    </a>
  </section>;
}
