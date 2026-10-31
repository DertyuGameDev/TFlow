import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

try { createRequire(import.meta.url).resolve('livekit-client'); }
catch { console.error('Не установлены зависимости интерфейса. Выполните npm ci, затем npm run dev.'); process.exit(1); }

if(existsSync(resolve('backend/.env.monitoring')))process.loadEnvFile(resolve('backend/.env.monitoring'));
if(existsSync(resolve('backend/.env.mail')))process.loadEnvFile(resolve('backend/.env.mail'));
if(existsSync(resolve('backend/.env.video')))process.loadEnvFile(resolve('backend/.env.video'));
process.env.TFLOW_DEMO_MODE ??= '1';

const python=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
if(!existsSync(python)){console.error('Run npm run setup first.');process.exit(1);}
const migration=spawnSync(python,['manage.py','migrate','--noinput'],{cwd:resolve('backend'),stdio:'inherit'});
if(migration.status!==0)process.exit(migration.status??1);
const children=[];let exiting=false;
function stop(code=0){if(exiting)return;exiting=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),200).unref();}
let videoBinary=process.env.LIVEKIT_SERVER_BINARY || [resolve('backend/data/tools/livekit-server'),'/opt/homebrew/bin/livekit-server','/usr/local/bin/livekit-server'].find(path=>existsSync(path));
async function videoReady(){
  try{return (await fetch('http://127.0.0.1:7880/', {signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}
}
if(!process.env.LIVEKIT_URL && !await videoReady()){
  if(!videoBinary){
    console.log('Подготавливаем локальный сервер вебинаров…');
    const installed=spawnSync(process.execPath,['scripts/setup-video.mjs'],{stdio:'inherit'});
    if(installed.status!==0){console.error('Не удалось подготовить вебинары. Выполните npm run setup:video или настройте backend/.env.video.');process.exit(1);}
    videoBinary=resolve('backend/data/tools/livekit-server');
  }
  const video=spawn(videoBinary,['--dev','--bind','127.0.0.1'],{stdio:['ignore','ignore','inherit']});
  children.push(video);
  video.on('error',()=>console.error('Video server could not start.'));
  video.on('exit',code=>{if(!exiting&&code)console.error('Video server stopped; the website remains available.');});
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(await videoReady()){ready=true;break;}
    if(video.exitCode!==null)break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!ready){console.error('Сервер вебинаров не запустился на 127.0.0.1:7880.');stop(1);process.exit(1);}
}
const server=spawn(python,['manage.py','runserver','127.0.0.1:8000'],{cwd:resolve('backend'),stdio:'inherit'});
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
  const reminders=spawn(python,['manage.py','send_activity_reminders','--watch'],{cwd:resolve('backend'),stdio:'inherit'});
  children.push(reminders);
  reminders.on('exit',code=>{if(!exiting&&code)console.error('Reminder worker stopped; restart npm run dev to resume reminders.');});
  const emailEnabled=process.env.NOTIFICATION_EMAIL_ENABLED ?? (process.env.EMAIL_HOST_USER&&process.env.EMAIL_HOST_PASSWORD?'1':'0');
  if(emailEnabled==='1'){
    const mailer=spawn(python,['manage.py','send_notification_emails','--watch'],{cwd:resolve('backend'),stdio:'inherit'});
    children.push(mailer);
    mailer.on('exit',code=>{if(!exiting&&code)console.error('Email worker stopped; pending messages stay in the database.');});
  }
  console.log('\nТФлоу: http://127.0.0.1:5173/ · API: Django 127.0.0.1:8000\n');
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
