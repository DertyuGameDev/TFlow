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
    {program.activities.length ? <ActivityProgram {...program} /> : <div className="program-no-results">
      <h3>Онлайн-флоу пока нет</h3>
      <p>Чтобы флоу появился здесь, выберите для него онлайн-аудиторию в программе мероприятия. Очные активности остаются в очной программе.</p>
    </div>}
    {program.organizer && <a className="button primary" href={`#manage/${encodeURIComponent(event.id)}/program`}>
      Добавить онлайн-флоу
    </a>}

    <a className="button secondary" href={webinarPath(event.id, "general")}>
      <Video size={17} />{program.organizer ? "Студия общего эфира мероприятия" : "Общий эфир мероприятия"}
    </a>
  </section>;
}
