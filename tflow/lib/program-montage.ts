export type MontageAction={operation:'move'|'insert'|'split'|'swap'|'copy'|'undo';activity_id?:string;target_id?:string;position?:'before'|'after'|'inside';at?:number;starts_at?:number;ends_at?:number;room_id?:string;undo?:string};
export type MontageResult={undo:string|null;created_ids:string[]};
