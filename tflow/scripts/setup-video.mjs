import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const target=resolve('backend/data/tools/livekit-server');
if(existsSync(target)){console.log(`LiveKit is ready: ${target}`);process.exit(0);}
const arch=process.arch==='arm64'?'arm64':'amd64';
async function json(url){const response=await fetch(url);if(!response.ok)throw new Error(`Download failed: ${response.status}`);return response.json();}
let url,sha,headers={};
if(process.platform==='darwin'&&process.arch==='arm64'){
  const formula=await json('https://formulae.brew.sh/api/formula/livekit.json');
  const major=Number(execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim().split('.')[0]);
  const key=major>=26?'arm64_tahoe':'arm64_sequoia';
  const bottle=formula.bottle.stable.files[key];
  if(!bottle)throw new Error('Install LiveKit using Homebrew: brew install livekit');
  url=bottle.url;sha=bottle.sha256;
  const auth=await json('https://ghcr.io/token?service=ghcr.io&scope=repository:homebrew/core/livekit:pull');
  headers={Authorization:`Bearer ${auth.token}`};
}else if(process.platform==='linux'){
  const release=await json('https://api.github.com/repos/livekit/livekit/releases/latest');
  const asset=release.assets.find(item=>item.name.endsWith(`linux_${arch}.tar.gz`));
  if(!asset)throw new Error('No matching LiveKit release. See https://docs.livekit.io/transport/self-hosting/local/');
  url=asset.browser_download_url;
  const checksums=await fetch(release.assets.find(item=>item.name==='checksums.txt').browser_download_url).then(response=>response.text());
  sha=checksums.split('\n').find(line=>line.trim().endsWith(asset.name))?.trim().split(/\s+/)[0];
}else throw new Error('Install LiveKit from https://docs.livekit.io/transport/self-hosting/local/ and set LIVEKIT_SERVER_BINARY.');
if(!sha)throw new Error('Official checksum is missing.');
const response=await fetch(url,{headers});if(!response.ok)throw new Error(`Download failed: ${response.status}`);
const bytes=Buffer.from(await response.arrayBuffer());
if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error('LiveKit checksum mismatch.');
const temporary=mkdtempSync(join(tmpdir(),'tflow-video-'));
try{
  const archive=join(temporary,'server.tar.gz');writeFileSync(archive,bytes);
  const listing=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).split('\n');
  const member=listing.find(name=>name.split('/').pop()==='livekit-server');
  if(!member)throw new Error('LiveKit executable not found in archive.');
  const extracted=join(temporary,'livekit-server'),fd=openSync(extracted,'w');
  const result=spawnSync('tar',['-xOf',archive,member],{stdio:['ignore',fd,'inherit']});closeSync(fd);
  if(result.status!==0)throw new Error('LiveKit extraction failed.');
  mkdirSync(resolve('backend/data/tools'),{recursive:true});writeFileSync(target,readFileSync(extracted));chmodSync(target,0o755);
  console.log('LiveKit installed with verified SHA-256. npm run dev will start it automatically.');
}finally{rmSync(temporary,{recursive:true,force:true});}
