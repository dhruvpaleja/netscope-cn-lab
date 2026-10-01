import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkLab, validateConfig } from '../src/network.js';
import { createLineDecoder, MAX_FRAME_BYTES } from '../src/framing.js';
import { runComparison } from '../src/experiments.js';

async function withLab(mode, fn, extra={}) {
  const lab=new NetworkLab({mode,...extra});
  try {await lab.start();await fn(lab);} finally {await lab.stop();}
}

test('Framing: one JSON message split across TCP chunks',()=>{
  const frames=[];const decode=createLineDecoder(f=>frames.push(f));
  decode('{"kind":"DA');decode('TA","text":"hello"}\n');
  assert.deepEqual(frames,[{kind:'DATA',text:'hello'}]);
});
test('Framing: multiple messages in a single TCP chunk',()=>{
  const frames=[];const decode=createLineDecoder(f=>frames.push(f));
  decode('{"n":1}\n{"n":2}\n');assert.equal(frames.length,2);
});
test('Framing: malformed JSON is rejected safely',()=>{
  let error;const decode=createLineDecoder(()=>assert.fail(),e=>error=e);
  decode('{broken}\n');assert.ok(error instanceof Error);
});
test('Framing: non-object JSON is rejected',()=>{
  let error;createLineDecoder(()=>assert.fail(),e=>error=e)('[]\n');assert.ok(error);
});
test('Framing: oversized unterminated input is rejected',()=>{
  let error;createLineDecoder(()=>assert.fail(),e=>error=e)('x'.repeat(MAX_FRAME_BYTES+1));assert.ok(error);
});
test('Configuration limits reject invalid modes, sizes and delays',()=>{
  assert.throws(()=>validateConfig({mode:'invalid',count:4,delayMs:0}));
  assert.throws(()=>validateConfig({mode:'peer-to-peer',count:9,delayMs:0}));
  assert.throws(()=>validateConfig({mode:'client-server',count:4,delayMs:-1}));
});
for(const mode of ['client-server','peer-to-peer']) {
  test(`${mode}: real ports and expected logical connections`,()=>withLab(mode,async lab=>{
    const state=lab.snapshot();assert.equal(state.stats.activeLinks,mode==='client-server'?4:6);
    assert.ok(state.nodes.every(n=>Number.isInteger(n.port)&&n.port>0));
    assert.ok(lab.sockets.size>0);assert.equal(state.stats.reachablePairs,6);
  }));
  test(`${mode}: unicast crosses sockets and returns an application ACK`,()=>withLab(mode,async lab=>{
    const m=await lab.send({from:'A',to:'B',text:'hello'});
    assert.equal(m.status,'delivered');assert.ok(m.outcomes[0].rttMs>=0);
    assert.equal(lab.nodes.get('B').inbox[0].text,'hello');
    assert.equal(lab.snapshot().stats.transmissions,mode==='client-server'?4:2);
    assert.equal(lab.snapshot().stats.acknowledged,1);
  }));
  test(`${mode}: bidirectional communication`,()=>withLab(mode,async lab=>{
    assert.equal((await lab.send({from:'D',to:'A',text:'reverse'})).status,'delivered');
    assert.equal((await lab.send({from:'B',to:'C',text:'sideways'})).status,'delivered');
  }));
  test(`${mode}: broadcast reaches every other node, not the sender`,()=>withLab(mode,async lab=>{
    const m=await lab.send({from:'A',to:'ALL',text:'broadcast'});
    assert.equal(m.delivered,3);assert.equal(m.expected,3);assert.equal(lab.nodes.get('A').inbox.length,0);
    assert.equal(lab.snapshot().stats.transmissions,mode==='client-server'?10:6);
  }));
  test(`${mode}: peer failure preserves unrelated pairs and recovery works`,()=>withLab(mode,async lab=>{
    await lab.setNode('D',false);
    assert.equal((await lab.send({from:'A',to:'B',text:'survivors'})).status,'delivered');
    assert.equal((await lab.send({from:'A',to:'D',text:'offline'})).status,'failed');
    assert.equal(lab.snapshot().stats.reachablePairs,3);
    await lab.setNode('D',true);
    assert.equal((await lab.send({from:'D',to:'A',text:'recovered'})).status,'delivered');
  }));
  test(`${mode}: partially delivered broadcast counts offline targets`,()=>withLab(mode,async lab=>{
    await lab.setNode('C',false);const m=await lab.send({from:'A',to:'ALL',text:'mixed'});
    assert.equal(m.status,'partial');assert.equal(m.delivered,2);assert.equal(m.expected,3);
    assert.equal(lab.snapshot().stats.failed,1);
  }));
  test(`${mode}: Unicode survives actual TCP transport`,()=>withLab(mode,async lab=>{
    const text='नमस्ते 🌐 — Dhruv, Manan, Armaan';
    await lab.send({from:'A',to:'B',text});assert.equal(lab.nodes.get('B').inbox[0].text,text);
  }));
  test(`${mode}: input validation and payload byte limit`,()=>withLab(mode,async lab=>{
    await assert.rejects(lab.send({from:'A',to:'A',text:'x'}));
    await assert.rejects(lab.send({from:'A',to:'B',text:''}));
    await assert.rejects(lab.send({from:'A',to:'Z',text:'x'}));
    await assert.rejects(lab.send({from:'A',to:'B',text:'🌐'.repeat(1025)}));
    assert.equal((await lab.send({from:'A',to:'B',text:'x'.repeat(4096)})).status,'delivered');
  }));
  test(`${mode}: concurrent messages retain unique IDs and ACK matching`,()=>withLab(mode,async lab=>{
    const results=await Promise.all(Array.from({length:10},(_,i)=>lab.send({from:'A',to:'B',text:`Message ${i}`})));
    assert.equal(new Set(results.map(m=>m.id)).size,10);assert.ok(results.every(m=>m.status==='delivered'));
  }));
}
test('Central server failure blocks every client pair; restart recovers',()=>withLab('client-server',async lab=>{
  await lab.setHub(false);assert.equal(lab.snapshot().stats.activeLinks,0);
  assert.equal((await lab.send({from:'A',to:'B',text:'failure'})).status,'failed');
  await lab.setHub(true);assert.equal((await lab.send({from:'A',to:'B',text:'restored'})).status,'delivered');
}));
test('P2P has no data hub to fail',()=>withLab('peer-to-peer',async lab=>{
  await assert.rejects(lab.setHub(false),/no central/);
}));
test('Teaching delay applies to all four client-server DATA/ACK hops',()=>withLab('client-server',async lab=>{
  const m=await lab.send({from:'A',to:'B',text:'delayed'});assert.ok(m.outcomes[0].rttMs>=32);
},{delayMs:10}));
test('Reset switches architecture, clears prior metrics, releases old sockets',()=>withLab('client-server',async lab=>{
  await lab.send({from:'A',to:'B',text:'before'});await lab.reset({mode:'peer-to-peer',count:5});
  assert.equal(lab.snapshot().stats.activeLinks,10);assert.equal(lab.snapshot().stats.attempts,0);
  assert.equal((await lab.send({from:'A',to:'E',text:'after'})).status,'delivered');
}));
test('Eight-peer full mesh creates exactly 28 connections',()=>withLab('peer-to-peer',async lab=>{
  assert.equal(lab.snapshot().stats.activeLinks,28);
  assert.equal((await lab.send({from:'A',to:'ALL',text:'all eight'})).delivered,7);
},{count:8}));
test('Offline sender reports failure instead of silently transmitting',()=>withLab('peer-to-peer',async lab=>{
  await lab.setNode('A',false);assert.equal((await lab.send({from:'A',to:'B',text:'blocked'})).status,'failed');
}));
test('Comparison runs real trials, validates failure and recovery for both modes',async()=>{
  const r=await runComparison({count:4,messages:5,trials:1,delayMs:0});
  assert.equal(r.architectures.length,2);
  const [cs,p2p]=r.architectures;
  assert.equal(cs.acknowledged,5);assert.equal(p2p.acknowledged,5);
  assert.equal(cs.failure.survivorDelivered,0);assert.equal(p2p.failure.survivorDelivered,5);
  assert.equal(cs.failure.recoveredStatus,'delivered');assert.equal(p2p.failure.recoveredStatus,'delivered');
});
