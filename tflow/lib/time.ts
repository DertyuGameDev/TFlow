export const dateLabel = (ms: number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day:"numeric",month:"long",...options }).format(ms);
export const timeLabel = (ms: number) => new Intl.DateTimeFormat("ru-RU", { timeZone:"Europe/Moscow",hour:"2-digit",minute:"2-digit" }).format(ms);
export const dateKey = (ms: number) => new Date(ms+3*3600000).toISOString().slice(0,10);
export const localInput = (ms: number) => new Date(ms+3*3600000).toISOString().slice(0,16);
export const fromLocalInput = (value: string) => new Date(`${value}:00+03:00`).getTime();
export const overlaps = (a: {starts_at:number;ends_at:number}, b: {starts_at:number;ends_at:number}) => a.starts_at < b.ends_at && a.ends_at > b.starts_at;
