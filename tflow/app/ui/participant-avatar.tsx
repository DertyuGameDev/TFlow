import { UserRound } from "lucide-react";

export function ParticipantAvatar({ name }: { name: string }) {
  const initial = name.trim().slice(0, 1).toLocaleUpperCase("ru");
  return (
    <span className="small-person-avatar" aria-hidden="true">
      {initial || <UserRound size={20} />}
    </span>
  );
}
