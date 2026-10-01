import { writeFile, mkdir } from 'node:fs/promises';
import { runComparison } from '../src/experiments.js';
import { NetworkLab } from '../src/network.js';

await mkdir('evidence',{recursive:true});
const comparison=await runComparison({count:4,messages:30,trials:3,delayMs:0},console.log);
await writeFile('evidence/comparison-results.json',JSON.stringify(comparison,null,2));
const lab=new NetworkLab();
try {
  await lab.start();
  await lab.send({from:'A',to:'B',text:'Hello from NetScope!'});
  await lab.send({from:'C',to:'ALL',text:'Group 01 broadcast: Dhruv, Manan and Armaan.'});
  await lab.send({from:'D',to:'A',text:'नमस्ते 🌐 — UTF-8 verified over TCP.'});
  await writeFile('evidence/client-server-session.json',JSON.stringify(lab.snapshot(),null,2));
  await lab.setHub(false);
  await lab.send({from:'A',to:'B',text:'Does delivery survive a hub failure?'});
  await writeFile('evidence/hub-failure-session.json',JSON.stringify(lab.snapshot(),null,2));
  await lab.reset({mode:'peer-to-peer'});
  await lab.setNode('D',false);
  await lab.send({from:'A',to:'B',text:'The surviving peers can still communicate.'});
  await lab.send({from:'A',to:'D',text:'An offline peer remains unreachable.'});
  await writeFile('evidence/peer-failure-session.json',JSON.stringify(lab.snapshot(),null,2));
} finally {await lab.stop();}
console.log('Evidence saved under evidence/. Values are measured, not hard-coded.');
