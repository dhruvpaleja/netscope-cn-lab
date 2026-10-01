import { NetworkLab } from '../src/network.js';
import { runComparison } from '../src/experiments.js';

// No shared mutable lab: each invocation owns and closes its loopback sockets.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({error:'Use POST'});
  let lab;
  try {
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!input || JSON.stringify(input).length > 20000) throw new Error('Invalid request');
    const {action, config = {}, body = {}, offline = [], hubUp = true} = input;
    if (!['state','reset','send','node','hub','compare'].includes(action)) throw new Error('Unknown action');
    if (action === 'compare') {
      // Hosted comparison bounds keep a public request small and predictable.
      if ((body.messages ?? 30) * (body.trials ?? 3) > 150 || (body.delayMs ?? 0) !== 0)
        throw new Error('Hosted comparisons allow up to 150 messages per architecture with no teaching delay.');
      return res.status(200).json({result:await runComparison(body)});
    }
    const next = action === 'reset' ? {...config,...body} : config;
    lab = new NetworkLab({mode:next.mode,count:next.count,delayMs:next.delayMs});
    await lab.start();
    if (action !== 'reset') {
      if (!Array.isArray(offline) || offline.length > 8 || typeof hubUp !== 'boolean') throw new Error('Invalid topology');
      for (const id of offline) await lab.setNode(id,false);
      if (lab.mode === 'client-server' && !hubUp) await lab.setHub(false);
    }
    // Connection setup is excluded from action events and transmission counters.
    lab.events=[];lab.sequence=0;lab.resetMetrics();
    let result;
    if (action === 'send') result = await lab.send(body);
    if (action === 'node' || action === 'hub') {
      if (typeof body.up !== 'boolean') throw new Error('up must be boolean');
      result = action === 'node' ? await lab.setNode(body.id,body.up) : await lab.setHub(body.up);
    }
    const state = {...lab.snapshot(),busy:false,busyMessage:'',historyCount:0};
    return res.status(200).json({state,result:result || state});
  } catch (error) {
    return res.status(400).json({error:error.message || 'Experiment failed'});
  } finally { if (lab) await lab.stop(); }
}
