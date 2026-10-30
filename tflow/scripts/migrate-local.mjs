import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const config='dist/server/wrangler.json';
if(!existsSync(config))throw new Error('Сначала выполните npm run build');
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
const folder='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const sqlite=existsSync(folder)?readdirSync(folder).find(f=>f.endsWith('.sqlite')):undefined;
// Inspect local SQLite read-only to avoid replaying an already applied migration.
// Wrangler executes SQL against the actual D1 binding; this file never migrates production.
let tables=[];
if(sqlite){const db=new DatabaseSync(resolve(folder,sqlite),{readOnly:true});tables=db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all().map(r=>r.name);db.close();}
for(const entry of journal.entries){
  const done=entry.idx===0?tables.includes('events'):entry.idx===1?tables.includes('registration_guard'):false;
  if(done){console.log(`Already applied: ${entry.tag}`);continue;}
  const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',config,'--persist-to','.wrangler/state','--file',`drizzle/${entry.tag}.sql`],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(result.status!==0)process.exit(result.status??1);
}
console.log('Local D1 is ready.');
