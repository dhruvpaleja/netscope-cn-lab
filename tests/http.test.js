import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('HTTP API, validation, local-only origin protection and exports',async t=>{
  const app=await createApp({port:0,persist:false});
  const post=(path,data,headers={})=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  try{
    await t.test('serves working HTML and JS assets',async()=>{
      assert.equal((await fetch(app.url+'/')).status,200);
      assert.equal((await fetch(app.url+'/app.js')).status,200);
    });
    await t.test('state includes real network, metadata and three correct members',async()=>{
      const s=await(await fetch(app.url+'/api/state')).json();assert.equal(s.nodes.length,4);
      assert.deepEqual(s.team.map(m=>m.roll),['I081','I053','I076']);
    });
    await t.test('send endpoint returns an acknowledged message',async()=>{
      const r=await post('/api/send',{from:'A',to:'B',text:'API message'});assert.equal(r.status,200);assert.equal((await r.json()).status,'delivered');
    });
    await t.test('invalid sender and reset input return 400',async()=>{
      assert.equal((await post('/api/send',{from:'Z',to:'B',text:'invalid'})).status,400);
      assert.equal((await post('/api/reset',{count:100})).status,400);
    });
    await t.test('rejects cross-origin writes',async()=>{
      assert.equal((await post('/api/send',{from:'A',to:'B',text:'x'},{Origin:'https://untrusted.example'})).status,403);
    });
    await t.test('rejects non-JSON body',async()=>{
      assert.equal((await fetch(app.url+'/api/send',{method:'POST',headers:{'Content-Type':'text/plain'},body:'x'})).status,415);
    });
    await t.test('unknown routes do not expose source files',async()=>{
      assert.equal((await fetch(app.url+'/server.js')).status,404);
      assert.equal((await fetch(app.url+'/does-not-exist')).status,404);
    });
    await t.test('JSON and CSV exports contain actual message evidence',async()=>{
      const json=await(await fetch(app.url+'/api/export')).json();assert.equal(json.state.messages[0].text,'API message');
      const csv=await(await fetch(app.url+'/api/export?format=csv')).text();assert.ok(csv.includes('Acknowledged'));assert.ok(csv.includes('delivered'));
    });
  } finally{await app.close();}
});

test('Native HTTP server-sent events deliver initial state and real socket events',async()=>{
  const app=await createApp({port:0,persist:false});
  const controller=new AbortController();
  try{
    const response=await fetch(app.url+'/api/events',{signal:controller.signal});
    assert.ok(response.headers.get('content-type').includes('text/event-stream'));
    const reader=response.body.getReader();const decoder=new TextDecoder();
    const first=decoder.decode((await reader.read()).value);assert.ok(first.includes('event: state'));
    const send=fetch(app.url+'/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:'A',to:'B',text:'SSE evidence'})});
    let text='';const deadline=Date.now()+2500;
    while(!text.includes('Delivery acknowledged')&&Date.now()<deadline){text+=decoder.decode((await reader.read()).value);}
    assert.ok(text.includes('event: network'));assert.ok(text.includes('data-hop'));assert.ok(text.includes('Delivery acknowledged'));
    assert.equal((await send).status,200);await reader.cancel();
  }finally{controller.abort();await app.close();}
});
