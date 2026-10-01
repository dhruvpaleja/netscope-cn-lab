import { NetworkLab } from './network.js';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

const round = n => Math.round(n * 1000) / 1000;
const p95 = values => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];

/** Both architectures use the same node count, UTF-8 payload and sequential workload. */
export async function runComparison({ count = 4, messages = 30, trials = 3, delayMs = 0 } = {}, progress = () => {}) {
  if (!Number.isInteger(messages) || messages < 5 || messages > 100) throw new Error('Messages per trial must be 5–100');
  if (!Number.isInteger(trials) || trials < 1 || trials > 5) throw new Error('Trials must be 1–5');
  const result = {
    id: randomUUID(), timestamp: new Date().toISOString(), environment: { node: process.version, platform: process.platform, transport: 'TCP / IPv4 loopback', processModel: 'One process; distinct TCP endpoints' },
    config: { count, messages, trials, delayMs, payloadBytes: 64, warmupMessages: 3 },
    methodology: 'Each trial starts fresh sockets, sends 3 excluded warm-up messages, then sequential 64-byte A-to-B unicasts. Application ACK RTT includes JSON parsing, event logging and any configured teaching delay. Not internet latency or bandwidth.',
    architectures: [], notes: 'Failure test removes HUB in client-server, or the final peer in peer-to-peer. Surviving-pair probes are always A-to-B. Timings vary by machine and run; no universal speed ranking is claimed.'
  };
  // Alternate trial order to reduce simple warm-up/order bias.
  const samples = { 'client-server': [], 'peer-to-peer': [] };
  for (let trial=0; trial<trials; trial++) {
    const order = trial % 2 ? ['peer-to-peer','client-server'] : ['client-server','peer-to-peer'];
    for (const mode of order) {
      progress(`Trial ${trial+1}/${trials}: ${mode}`);
      const lab = new NetworkLab({ mode, count, delayMs });
      try {
        await lab.start();
        for (let w=0;w<3;w++) await lab.send({ from:'A', to:'B', text:'W'.repeat(64) });
        lab.resetMetrics();
        const rtts=[];
        const started = performance.now();
        for (let i=0;i<messages;i++) {
          const message = await lab.send({ from:'A', to:'B', text:'N'.repeat(64) });
          if (message.outcomes[0].ok) rtts.push(message.outcomes[0].rttMs);
        }
        const elapsedMs=performance.now()-started;
        const state=lab.snapshot();
        samples[mode].push({ trial:trial+1, rttsMs:rtts, elapsedMs:round(elapsedMs), meanRttMs:round(rtts.reduce((a,b)=>a+b,0)/rtts.length), sequentialCompletionsPerSecond:round(rtts.length/(elapsedMs/1000)), delivered:rtts.length, attempts:messages, dataAckTransmissions:state.stats.transmissions, framedBytes:state.stats.wireBytes });
      } finally { await lab.stop(); }
    }
  }
  for (const mode of ['client-server','peer-to-peer']) {
    progress(`Checking failure and recovery: ${mode}`);
    const lab=new NetworkLab({mode,count,delayMs:0});
    try {
      await lab.start();
      const links=lab.snapshot().stats.activeLinks;
      const healthy=[];
      for(let i=0;i<5;i++) healthy.push((await lab.send({from:'A',to:'B',text:'Healthy probe'})).status==='delivered');
      const failedNode=String.fromCharCode(64+count);
      if(mode==='client-server') await lab.setHub(false); else await lab.setNode(failedNode,false);
      const during=[];
      for(let i=0;i<5;i++) during.push((await lab.send({from:'A',to:'B',text:'Surviving pair probe'})).status==='delivered');
      const unavailable=await lab.send({from:'A',to:failedNode,text:'Unavailable endpoint probe'});
      const reachablePairsDuring=lab.snapshot().stats.reachablePairs;
      if(mode==='client-server') await lab.setHub(true); else await lab.setNode(failedNode,true);
      const recovered=await lab.send({from:'A',to:failedNode,text:'Recovery probe'});
      const all=samples[mode].flatMap(s=>s.rttsMs);
      result.architectures.push({ mode, logicalLinks:links, dataHops:mode==='client-server'?2:1,
        meanRttMs:round(all.reduce((a,b)=>a+b,0)/all.length), p95RttMs:p95(all),
        acknowledged:all.length, attempted:messages*trials, successPct:round(all.length/(messages*trials)*100),
        trials:samples[mode], failure: { removed:mode==='client-server'?'HUB':failedNode,
          healthyDelivered:healthy.filter(Boolean).length, survivorDelivered:during.filter(Boolean).length, probeCount:5,
          unavailableTargetStatus:unavailable.status, recoveredStatus:recovered.status, reachablePairsDuring } });
    } finally { await lab.stop(); }
  }
  progress('Comparison complete');
  return result;
}
