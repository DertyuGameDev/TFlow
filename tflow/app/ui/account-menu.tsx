import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { Profile } from "../../lib/types";
import { csrfToken } from "../../lib/session";
import { Avatar } from "./avatar";
import "../account-menu.css";

export function AccountMenu({ profile }: { profile: Pick<Profile, "name" | "avatar_url"> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[focusLast.current ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  }
  return <div className="account-menu" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" className="avatar account-menu-trigger" ref={trigger}
      aria-label="Меню аккаунта" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { focusLast.current = false; setOpen(!open); }}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); focusLast.current = event.key === "ArrowUp"; setOpen(true);
        }
      }}>
      <Avatar profile={profile} />
    </button>
    {open && <div id={id} role="menu" aria-label="Аккаунт" className="account-dropdown" ref={menu}
      onKeyDown={keyboard}>
      <p className="account-dropdown-name">{profile.name}</p>
      <a role="menuitem" href="#profile" onClick={() => setOpen(false)}><UserRound size={18} />Профиль</a>
      <form method="post" action="/logout/" role="none">
        <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken()} />
        <button type="submit" role="menuitem"><LogOut size={18} />Выйти из аккаунта</button>
      </form>
    </div>}
  </div>;
}
