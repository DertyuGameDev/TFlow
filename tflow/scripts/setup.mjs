import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const python=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const uv=spawnSync('uv',['--version'],{stdio:'ignore'}).status===0;
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{stdio:'inherit',...options});if(r.status!==0)process.exit(r.status??1);}
if(!existsSync(python)){
  if(uv)run('uv',['venv','--python','3.12','.venv']);
  else run(process.platform==='win32'?'python':'python3',['-m','venv','.venv']);
}
if(uv)run('uv',['pip','install','--python',python,'-r','backend/requirements.lock.txt']);
else run(python,['-m','pip','install','-r','backend/requirements.lock.txt']);
run(python,['manage.py','migrate','--noinput'],{cwd:resolve('backend')});
console.log('\nReady. Run npm run dev.');
