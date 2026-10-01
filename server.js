import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NetworkLab } from './src/network.js';
import { runComparison } from './src/experiments.js';

const ROOT=dirname(fileURLToPath(import.meta.url));
const TEAM=[{name:'Dhruv Paleja',roll:'I081'},{name:'Manan Shah',roll:'I053'},{name:'Armaan Lad',roll:'I076'}];
const csvCell = value => '"' + String(value ?? '').replace(/"/g,'""').replace(/^[=+@-]/,"'$&") + '"';

export async function createApp({port=Number(process.env.PORT || 3000), persist=true}={}) {
  if(!Number.isInteger(port)||port<0||port>65535) throw new Error('PORT must be a valid TCP port');
  const lab=new NetworkLab(); await lab.start();
  let history=[]; let busy=false; let busyMessage=''; let closing=false;
  const clients=new Set();
  const dataPath=join(ROOT,'data','experiments.json');
  if(persist) {
    try { const saved=JSON.parse(await readFile(dataPath,'utf8')); if(Array.isArray(saved)) history=saved.slice(0,30); }
    catch(error) { if(error.code!=='ENOENT') console.warn('History could not be loaded:',error.message); }
  }
  const fullState=()=>({...lab.snapshot(),busy,busyMessage,team:TEAM,historyCount:history.length});
  const push=(type,data)=>{ const text=`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for(const client of clients) { if(!client.destroyed && client.writableLength < 1024*1024) client.write(text); else {client.destroy();clients.delete(client);} } };
  let stateTimer;
  const pushState=()=>{ if(stateTimer) return; stateTimer=setTimeout(()=>{stateTimer=null;push('state',fullState());},35); };
  lab.on('change',pushState); lab.on('event',event=>push('network',event));
  const heartbeat=setInterval(()=>{for(const client of clients) client.write(': heartbeat\n\n');},15000);
  heartbeat.unref();

  const security={
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control':'no-store'
  };
  function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',...security});res.end(JSON.stringify(data));}
  async function body(req){
    if(!String(req.headers['content-type']||'').startsWith('application/json')) throw Object.assign(new Error('Use application/json'),{status:415});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(new Error('Request body too large'),{status:413});chunks.push(chunk);}
    let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
    if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('Expected a JSON object'),{status:400});
    return value;
  }
  async function action(res,title,fn){
    if(busy){json(res,409,{error:'Another action is running. Please wait for it to finish.'});return;}
    busy=true;busyMessage=title;pushState();
    try{json(res,200,await fn());}finally{busy=false;busyMessage='';pushState();}
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host;
      const actualPort=server.address()?.port;
      // Local-only control surface: reject unexpected Host and cross-origin writes.
      if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(host)){json(res,403,{error:'Use localhost or 127.0.0.1'});return;}
      const url=new URL(req.url,`http://${host}`);
      if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${host}`){json(res,403,{error:'Cross-origin requests are not allowed'});return;}
      if(req.method==='GET'&&url.pathname==='/api/state'){json(res,200,fullState());return;}
      if(req.method==='GET'&&url.pathname==='/api/history'){json(res,200,history);return;}
      if(req.method==='GET'&&url.pathname==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive',...security});
        res.write(`event: state\ndata: ${JSON.stringify(fullState())}\n\n`);clients.add(res);
        req.once('close',()=>clients.delete(res));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/export'){
        const format=url.searchParams.get('format')||'json';
        if(format==='csv'){
          const rows=[['Timestamp','Architecture','Sender','Recipient','Status','Acknowledged','Expected','Payload bytes'],...lab.messages.map(m=>[m.timestamp,m.mode,m.from,m.to,m.status,m.delivered,m.expected,m.bytes])];
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="netscope-messages.csv"',...security});res.end(rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));return;
        }
        if(format!=='json'){json(res,400,{error:'Export format must be json or csv'});return;}
        res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="netscope-session.json"',...security});
        res.end(JSON.stringify({exportedAt:new Date().toISOString(),team:TEAM,state:fullState(),history},null,2));return;
      }
      if(req.method==='POST'){
        const input=await body(req);
        if(url.pathname==='/api/reset')return await action(res,'Building TCP connections',()=>lab.reset(input));
        if(url.pathname==='/api/send')return await action(res,'Waiting for application acknowledgements',()=>lab.send(input));
        if(url.pathname==='/api/hub'){
          if(typeof input.up!=='boolean')throw new Error('up must be true or false');
          return await action(res,'Changing central server state',()=>lab.setHub(input.up));
        }
        if(url.pathname==='/api/node'){
          if(typeof input.up!=='boolean')throw new Error('up must be true or false');
          return await action(res,'Changing peer state',()=>lab.setNode(input.id,input.up));
        }
        if(url.pathname==='/api/compare')return await action(res,'Running controlled comparison',async()=>{
          const result=await runComparison(input,message=>{busyMessage=message;pushState();});
          history.unshift(result);history=history.slice(0,30);
          if(persist){
            try{await mkdir(dirname(dataPath),{recursive:true});await writeFile(dataPath+'.tmp',JSON.stringify(history,null,2));
              const {rename}=await import('node:fs/promises');await rename(dataPath+'.tmp',dataPath);
            }catch(error){result.storageWarning='Comparison completed, but history could not be saved: '+error.message;}
          }
          push('comparison',result);return result;
        });
        json(res,404,{error:'Unknown API endpoint'});return;
      }
      if(req.method==='GET'){
        const assets={'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
        const asset=assets[url.pathname];
        if(asset){res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8',...security});res.end(await readFile(join(ROOT,'public',asset[0])));return;}
      }
      json(res,404,{error:'Not found'});
    }catch(error){if(!res.headersSent)json(res,error.status||400,{error:error.message});else res.end();}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(error){await lab.stop();clearInterval(heartbeat);throw error;}
  async function close(){
    if(closing)return;closing=true;clearInterval(heartbeat);clearTimeout(stateTimer);
    lab.removeListener('change',pushState);
    for(const client of clients)client.end();clients.clear();
    await lab.stop();await new Promise(resolve=>server.close(resolve));
  }
  return {server,lab,close,url:`http://127.0.0.1:${server.address().port}`};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  createApp().then(app=>{
    console.log(`\n  NETSCOPE / Computer Networks Lab\n  Open ${app.url}\n  Real TCP sockets • Localhost only • No external dependencies\n  Press Ctrl+C to stop.\n`);
    const shutdown=()=>app.close().then(()=>process.exit(0));
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  }).catch(error=>{console.error('Could not start NetScope:',error.message);if(error.code==='EADDRINUSE')console.error('Port is busy. Close the other app or set PORT=3001.');process.exit(1);});
}
