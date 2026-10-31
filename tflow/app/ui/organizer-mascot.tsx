import { useDarkTheme } from "../../lib/use-theme";
import "../organizer-dashboard.css";

export function OrganizerMascot() {
  const dark = useDarkTheme();
  return (
    <aside className="organizer-mascot" aria-hidden="true">
      <div className="organizer-mascot-copy">
        <span>ТФлоу · События и люди</span>
        <p>Собирайте людей вокруг своих идей</p>
      </div>
      <div className="organizer-mascot-picture">
        <img
          src={`/images/organizer-axolotl-${dark ? "dark" : "light"}.webp`}
          alt=""
          width={749}
          height={2100}
          loading="lazy"
          decoding="async"
        />
      </div>
    </aside>
  );
}
