import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/cloud.js';
async function call(body) {let status=200,data;const res={setHeader(){},status(s){status=s;return this;},json(d){data=d;return this;}};await handler({method:'POST',body},res);return {status,...data};}
test('Hosted actions use real sockets, preserve failure configuration, and isolate sessions',async()=>{
 const [a,b]=await Promise.all([call({action:'send',body:{from:'A',to:'B',text:'hello'}}),call({action:'state'})]);
 assert.equal(a.result.status,'delivered');assert.equal(b.state.messages.length,0);assert.ok(a.state.stats.transmissions>=4);
 const down=await call({action:'send',hubUp:false,body:{from:'A',to:'B',text:'hub down'}});assert.equal(down.result.status,'failed');
 const p2p=await call({action:'send',config:{mode:'peer-to-peer'},offline:['D'],body:{from:'A',to:'B',text:'survivors'}});assert.equal(p2p.result.status,'delivered');assert.equal(p2p.state.stats.activeLinks,3);
 assert.equal((await call({action:'send',body:{from:'A',to:'A',text:'bad'}})).status,400);
 assert.equal((await call({action:'compare',body:{messages:100,trials:5}})).status,400);
 const comp=await call({action:'compare',body:{messages:5,trials:1,count:4}});assert.equal(comp.result.architectures.length,2);
});
