import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const python=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
if(!existsSync(python)){console.error('Run npm run setup first.');process.exit(1);}
const migration=spawnSync(python,['manage.py','migrate','--noinput'],{cwd:resolve('backend'),stdio:'inherit'});
if(migration.status!==0)process.exit(migration.status??1);
const children=[];let exiting=false;
function stop(code=0){if(exiting)return;exiting=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),200).unref();}
const server=spawn(python,['manage.py','runserver','127.0.0.1:8000','--noreload'],{cwd:resolve('backend'),stdio:'inherit'});
children.push(server);
server.on('exit',code=>stop(code??1));
let ready=false;
for(let attempt=0;attempt<100;attempt++){
  try{const response=await fetch('http://127.0.0.1:8000/api/health');if(response.ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
}
if(!ready){console.error('Django did not become ready on 127.0.0.1:8000.');stop(1);}
else{
  const frontend=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'});
  children.push(frontend);frontend.on('exit',code=>stop(code??1));
  console.log('\nТФлоу: http://127.0.0.1:5173/ · API: Django 127.0.0.1:8000\n');
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
