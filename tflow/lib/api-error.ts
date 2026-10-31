import type { RequiredProfileField } from "./types";

export class ApiError extends Error {
  code: string;
  fields: Record<string,string[]>;
  missing_fields: RequiredProfileField[];
  constructor(payload:{error?:string;code?:string;fields?:Record<string,string[]>;missing_fields?:RequiredProfileField[]}){
    super(payload.error||"Не удалось выполнить действие");
    this.code=payload.code??"UNKNOWN";
    this.fields=payload.fields??{};
    this.missing_fields=payload.missing_fields??[];
  }
}
