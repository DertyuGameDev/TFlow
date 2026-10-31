import type { ParticipantData } from "./types";

export type ProfileFieldDefinition = { key: keyof ParticipantData; label: string; group: string; type?: "tel" | "date" | "url" | "textarea"; placeholder?: string; autocomplete?: string };
export const PROFILE_FIELDS: ProfileFieldDefinition[] = [
  {key:"name",label:"Имя и фамилия",group:"Контакты",autocomplete:"name"},
  {key:"email",label:"Электронная почта",group:"Контакты"},
  {key:"phone",label:"Телефон",group:"Контакты",type:"tel",placeholder:"+7 999 123-45-67",autocomplete:"tel"},
  {key:"birth_date",label:"Дата рождения",group:"Контакты",type:"date",autocomplete:"bday"},
  {key:"city",label:"Город",group:"Контакты",autocomplete:"address-level2"},
  {key:"telegram",label:"Telegram",group:"Контакты",placeholder:"@username"},
  {key:"organization",label:"Место работы",group:"Работа и учёба",autocomplete:"organization"},
  {key:"job_title",label:"Должность",group:"Работа и учёба",autocomplete:"organization-title"},
  {key:"education",label:"Образование",group:"Работа и учёба",placeholder:"Учебное заведение, специальность"},
  {key:"website",label:"Сайт или портфолио",group:"Работа и учёба",type:"url",placeholder:"https://",autocomplete:"url"},
  {key:"about",label:"О себе",group:"О себе",type:"textarea",placeholder:"Чем занимаетесь и что вам интересно"},
  {key:"interests",label:"Интересы",group:"О себе",placeholder:"Дизайн, разработка, предпринимательство"},
];
export const REQUIREMENT_FIELDS = PROFILE_FIELDS.filter(field=>field.key!=="name"&&field.key!=="email");
export function profileValue(key: keyof ParticipantData, value: string) {
  if(key==="birth_date"&&value){const [year,month,day]=value.split("-");return `${day}.${month}.${year}`;}
  return value;
}
