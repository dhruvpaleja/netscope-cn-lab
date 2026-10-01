'use strict';
// Browser-held session; the server never accepts client-supplied logs or metrics.
window.cloudLab = {
  state:null, history:[],
  async action(action,body={}) {
    const old=this.state;
    const response=await fetch('/api/cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      action,body,config:old?{mode:old.mode,count:old.count,delayMs:old.delayMs}:{},
      offline:old?old.nodes.filter(n=>!n.up).map(n=>n.id):[],hubUp:old?old.hub.up:true
    })});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Experiment failed');
    if(action==='compare') {this.history.unshift(data.result);this.history=this.history.slice(0,10);return data.result;}
    const next=data.state;
    if(old && action!=='reset') {
      next.messages=[...next.messages,...old.messages].slice(0,200);
      const offset=old.events.at(-1)?.id||0;
      next.events=[...old.events,...next.events.map(e=>({...e,id:e.id+offset}))].slice(-300);
      for(const node of next.nodes) {
        const prev=old.nodes.find(n=>n.id===node.id);
        if(prev){node.sent+=prev.sent;node.received+=prev.received;node.inbox=[...prev.inbox,...node.inbox].slice(-200);}
      }
      for(const key of ['attempts','expected','acknowledged','failed','transmissions','wireBytes','payloadBytes','hubForwards']) next.stats[key]+=old.stats[key];
      const rtts=next.messages.flatMap(m=>m.outcomes.filter(o=>o.ok).map(o=>o.rttMs)).sort((a,b)=>a-b);
      next.stats.meanRttMs=rtts.length?rtts.reduce((a,b)=>a+b,0)/rtts.length:null;
      next.stats.p95RttMs=rtts.length?rtts[Math.ceil(rtts.length*.95)-1]:null;
      next.stats.successPct=next.stats.expected?next.stats.acknowledged/next.stats.expected*100:null;
    }
    this.state=next;return action==='send'?data.result:next;
  },
  export(format) {
    if(format==='csv') {
      const cell=v=>'"'+String(v??'').replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"';
      const rows=[['Timestamp','Architecture','Sender','Recipient','Status','Acknowledged','Expected','Payload bytes'],...this.state.messages.map(m=>[m.timestamp,m.mode,m.from,m.to,m.status,m.delivered,m.expected,m.bytes])];
      download('netscope-messages.csv',rows.map(r=>r.map(cell).join(',')).join('\r\n'),'text/csv');
    } else download('netscope-session.json',{exportedAt:new Date().toISOString(),state:this.state,history:this.history,environment:'Hosted: isolated real TCP experiments per request. Session held in this tab.'});
  }
};
