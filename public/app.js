'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format = (value,digits=2) => value == null ? '—' : Number(value).toLocaleString('en-IN',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const time = value => new Date(value).toLocaleTimeString('en-GB',{hour12:false});
const date = value => new Date(value).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const bytes = value => new TextEncoder().encode(value).length;
const architecture = mode => mode==='client-server'?'Client–server':'Peer-to-peer';
let state=null, selectedNode='A', recordTab='messages', currentView='lab', localBusy=false, topologyKey='', dropdownKey='', positions={}, history=[], currentComparison=null, toastTimer, stream;

function notify(text) {
  $('#toast').textContent=text;$('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4000);
}
function showError(error) {
  $('#global-error').textContent=error.message||String(error);$('#global-error').classList.remove('hidden');
}
async function get(path) {
  if(document.documentElement.dataset.hosted){if(path==='/api/state'){if(!cloudLab.state)await cloudLab.action('state');return cloudLab.state;}if(path==='/api/history')return cloudLab.history;}
  const response=await fetch(path);const data=await response.json();
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data;
}
async function post(path,body={}) {
  if(localBusy)return null;
  localBusy=true;$('#global-error').classList.add('hidden');updateBusy();
  try {
    if(document.documentElement.dataset.hosted){const result=await cloudLab.action(path.split('/').pop(),body);state=cloudLab.state;render();if(path==='/api/send')state.events.filter(e=>e.messageId===result.id).forEach((e,i)=>setTimeout(()=>animateHop(e),i*70));return result;}
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
    state=await get('/api/state');render();return data;
  } catch(error) {showError(error);return null;}
  finally {localBusy=false;updateBusy();}
}
function updateBusy() {
  const busy=localBusy||state?.busy||!state;
  $$('#send-message,#mode-cs,#mode-p2p,#apply-config,#reset-network,#hub-toggle,#run-comparison,.node-button').forEach(button=>button.disabled=!!busy);
  $('#busy-banner').classList.toggle('hidden',!state?.busy);
  $('#busy-text').textContent=state?.busyMessage||'Working with the network';
}
function download(name,value,type='application/json') {
  const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;
  document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function render() {
  if(!state)return;
  if(!state.nodes.some(node=>node.id===selectedNode))selectedNode=state.nodes[0]?.id||'A';
  const metrics=[
    {label:'Connected endpoints',value:`${state.nodes.filter(n=>n.connected).length}<small>/ ${state.count}</small>`,note:'Logical hosts on this machine',icon:'◉'},
    {label:'Active TCP links',value:state.stats.activeLinks,note:state.mode==='client-server'?'N links · hub-and-spoke':'N(N − 1) / 2 · full mesh',icon:'⌘'},
    {label:'Delivery success',value:state.stats.successPct===null?'—':`${format(state.stats.successPct,0)}<small>%</small>`,note:`${state.stats.acknowledged} of ${state.stats.expected} recipient ACKs`,icon:'✓'},
    {label:'Mean application RTT',value:`${format(state.stats.meanRttMs)}<small>ms</small>`,note:state.delayMs?`Includes ${state.delayMs} ms / hop teaching delay`:'Measured · no artificial delay',icon:'↗'}
  ];
  $('#metrics').innerHTML=metrics.map(m=>`<article class="metric"><div class="metric-top"><span class="metric-label">${m.label}</span><span class="metric-icon">${m.icon}</span></div><div class="metric-number">${m.value}</div><div class="metric-note">${m.note}</div></article>`).join('');
  const cs=state.mode==='client-server';
  $('#topology-subtitle').textContent=cs?'Centralized message routing':'Direct peer-to-peer message routing';
  $('#canvas-meta').textContent=`${state.count} ENDPOINTS / ${state.stats.activeLinks} LINKS`;
  $('#architecture-insight').textContent=cs?'Every message passes through the central server. Click a node to inspect it.':'Peers send directly to one another. No central server forwards their messages.';
  $('#hop-badge').textContent=`${cs?2:1} DATA HOP${cs?'S':''}`;
  $$('[data-mode]').forEach(button=>{const chosen=button.dataset.mode===state.mode;button.classList.toggle('selected',chosen);button.setAttribute('aria-pressed',chosen);});
  const newDropdownKey=state.nodes.map(n=>n.id).join('');
  if(dropdownKey!==newDropdownKey){
    dropdownKey=newDropdownKey;
    const sender=$('#sender').value||'A';
    $('#sender').innerHTML=state.nodes.map(n=>`<option value="${n.id}">Node ${n.id}</option>`).join('');
    if(state.nodes.some(n=>n.id===sender))$('#sender').value=sender;
    updateRecipients();
  }
  $('#hub-toggle').classList.toggle('hidden',!cs);$('#hub-toggle').classList.toggle('offline',!state.hub.up);
  $('#hub-toggle .toggle-label').textContent=state.hub.up?'Stop server':'Restore server';
  $('#node-controls').innerHTML=state.nodes.map(n=>`<button class="node-button ${n.up?'':'offline'}" data-toggle-node="${n.id}" title="${n.up?'Stop':'Restore'} Node ${n.id}" aria-label="${n.up?'Stop':'Restore'} Node ${n.id}"><i></i>${n.id}</button>`).join('');
  $('#reachability').textContent=`${state.stats.reachablePairs} / ${state.stats.totalPairs} configured endpoint pairs remain reachable.`;
  $('#message-count').textContent=state.messages.length;
  drawTopology();renderRecords();renderEvents();updateBusy();
}
function updateRecipients() {
  if(!state)return;
  const selected=$('#recipient').value;
  $('#recipient').innerHTML=state.nodes.filter(n=>n.id!==$('#sender').value).map(n=>`<option value="${n.id}">Node ${n.id}</option>`).join('')+'<option value="ALL">Broadcast · all</option>';
  if([...$('#recipient').options].some(o=>o.value===selected))$('#recipient').value=selected;
}
function drawTopology() {
  const key=JSON.stringify({mode:state.mode,nodes:state.nodes.map(n=>[n.id,n.up,n.port]),hub:state.hub,selectedNode});
  if(topologyKey===key)return;topologyKey=key;
  const svg=$('#topology');const cx=400,cy=194;
  positions={HUB:{x:cx,y:cy}};
  state.nodes.forEach((node,i)=>{
    const angle=-Math.PI*3/4 + i*2*Math.PI/state.count;
    positions[node.id]={x:cx+Math.cos(angle)*270,y:cy+Math.sin(angle)*132};
  });
  let markup=`<defs><filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#9baa84" flood-opacity=".12"/></filter></defs>`;
  for(const link of state.links){const a=positions[link.from],b=positions[link.to];markup+=`<line class="network-link ${link.up?'':'offline'}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;}
  if(state.mode==='peer-to-peer')markup+=`<circle cx="400" cy="194" r="44" fill="#f8faf7" stroke="#e1e9d9" stroke-dasharray="3 4"/><text x="400" y="191" text-anchor="middle" font-size="10" font-weight="650" fill="#8b9e7b">NO CENTRAL</text><text x="400" y="207" text-anchor="middle" font-size="10" font-weight="650" fill="#8b9e7b">SERVER</text>`;
  if(state.mode==='client-server')markup+=`<g class="${state.hub.up?'':'hub-offline'}" transform="translate(400 194)"><rect class="hub-shape" x="-34" y="-34" width="68" height="68" rx="17" filter="url(#node-shadow)"/><rect x="-13" y="-17" width="26" height="11" rx="3" fill="none" stroke="#6d874a" stroke-width="1.5"/><rect x="-13" y="-2" width="26" height="11" rx="3" fill="none" stroke="#6d874a" stroke-width="1.5"/><circle cx="7" cy="-11.5" r="1.5" fill="#6d874a"/><circle cx="7" cy="3.5" r="1.5" fill="#6d874a"/><text y="61" text-anchor="middle" class="node-label">Central server</text><text y="76" text-anchor="middle" class="node-port">${state.hub.up?`127.0.0.1:${state.hub.port}`:'OFFLINE'}</text></g>`;
  for(const node of state.nodes){
    const p=positions[node.id];
    markup+=`<g class="svg-node ${node.up?'':'offline'} ${selectedNode===node.id?'selected':''}" transform="translate(${p.x} ${p.y})" data-inspect-node="${node.id}" role="button" tabindex="0" aria-label="Inspect Node ${node.id}, ${node.up?'online':'offline'}"><circle class="node-ring" r="34"/><circle class="node-circle" r="30" filter="url(#node-shadow)"/><rect x="-13" y="-12" width="26" height="18" rx="3" fill="none" stroke="${node.up?'#829970':'#bda393'}" stroke-width="1.5"/><path d="M-7 12H7M0 6V12" stroke="${node.up?'#829970':'#bda393'}" stroke-width="1.5"/><circle cx="25" cy="-24" r="5" fill="${node.up?'#9ebd71':'#c29981'}" stroke="#f8faf7" stroke-width="2"/><text y="54" text-anchor="middle" class="node-label">Node ${node.id}</text><text y="69" text-anchor="middle" class="node-port">${node.up?`127.0.0.1:${node.port}`:'OFFLINE'}</text></g>`;
  }
  markup+='<g id="packet-layer" aria-hidden="true"></g>';
  svg.innerHTML=markup;
}
function animateHop(event) {
  if(!['data-hop','ack-hop'].includes(event.type)||!positions[event.from]||!positions[event.to]||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const layer=$('#packet-layer');if(!layer||layer.childElementCount>24)return;
  const a=positions[event.from],b=positions[event.to];
  const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('r','4.5');circle.setAttribute('class',`packet ${event.type==='ack-hop'?'ack':''}`);layer.appendChild(circle);
  const start=performance.now();const duration=620;
  function tick(now){
    if(!circle.isConnected)return;
    const t=Math.min(1,(now-start)/duration);circle.setAttribute('cx',a.x+(b.x-a.x)*t);circle.setAttribute('cy',a.y+(b.y-a.y)*t);
    if(t<1)requestAnimationFrame(tick);else circle.remove();
  }
  requestAnimationFrame(tick);
}
function renderRecords() {
  const root=$('#records-content');
  if(recordTab==='messages'){
    if(!state.messages.length){root.innerHTML='<div class="empty-state"><div class="empty-symbol">↗</div><h2>Your first message starts here.</h2><p>Choose a sender and recipient, then transmit.<br>Delivery status and measured RTT will appear here.</p></div>';return;}
    root.innerHTML=`<div class="table-scroll"><table><thead><tr><th>TIME</th><th>ROUTE</th><th>PAYLOAD</th><th>STATUS</th><th>ACK RTT</th></tr></thead><tbody>${state.messages.map(m=>{
      const mean=m.outcomes.filter(o=>o.ok);const rtt=mean.length?mean.reduce((a,b)=>a+b.rttMs,0)/mean.length:null;
      return `<tr><td class="mono">${time(m.timestamp)}</td><td class="route-cell">${m.from} ${m.mode==='client-server'?'→ HUB ':''}→ ${m.to==='ALL'?'ALL':m.to}</td><td><div class="text-wrap" title="${escapeHTML(m.text)}">${escapeHTML(m.text)}</div></td><td><span class="status ${m.status}">${m.status==='delivered'?'✓':m.status==='partial'?'◐':'×'} ${m.status} · ${m.delivered}/${m.expected}</span></td><td class="mono">${rtt===null?'—':format(rtt)+' ms'}</td></tr>`;
    }).join('')}</tbody></table></div><div class="socket-note">Broadcast RTT is the mean of successful recipient ACKs. Failed deliveries have no RTT.</div>`;
  } else if(recordTab==='inbox'){
    const node=state.nodes.find(n=>n.id===selectedNode);
    root.innerHTML=`<div class="records-head"><span>Messages actually received at this TCP endpoint</span><select id="inbox-node" aria-label="Node inbox">${state.nodes.map(n=>`<option value="${n.id}" ${n.id===selectedNode?'selected':''}>Node ${n.id}</option>`).join('')}</select></div><div class="table-scroll">${node.inbox.length?node.inbox.map(m=>`<article class="inbox-message"><header><span>Node ${m.from} → Node ${node.id}</span><time>${time(m.timestamp)}</time></header><p>${escapeHTML(m.text)}</p></article>`).join(''):'<div class="empty-state"><div class="empty-symbol">▤</div><h2>This inbox is clear.</h2><p>Send a message to this node to see the received payload.</p></div>'}</div>`;
  } else {
    const rows=state.nodes.map(n=>`<tr><td>Node ${n.id}</td><td class="mono">127.0.0.1:${n.port||'—'}</td><td>${state.mode==='client-server'?'Client source port':'Peer listening port'}</td><td><span class="status ${n.connected?'delivered':'failed'}">${n.connected?'connected':n.up?'disconnected':'offline'}</span></td></tr>`).join('');
    root.innerHTML=`<div class="table-scroll"><table><thead><tr><th>ENDPOINT</th><th>SOCKET ADDRESS</th><th>PORT ROLE</th><th>STATE</th></tr></thead><tbody>${state.mode==='client-server'?`<tr><td>Central server</td><td class="mono">127.0.0.1:${state.hub.port}</td><td>Hub listening port</td><td><span class="status ${state.hub.up?'delivered':'failed'}">${state.hub.up?'listening':'offline'}</span></td></tr>`:''}${rows}</tbody></table></div><div class="socket-note">OS-assigned ephemeral ports. Offline endpoints retain their last known port for inspection. Client source ports are not listeners.</div>`;
  }
}
function renderEvents() {
  $('#event-stream').innerHTML=state.events.slice(-60).reverse().map(event=>`<article class="event ${escapeHTML(event.type)}"><time>${time(event.timestamp)}</time><span class="dot"></span><p>${escapeHTML(event.text)}</p></article>`).join('')||'<div class="empty-state"><p>Waiting for network events.</p></div>';
}
function renderComparison(result) {
  currentComparison=result;
  const maxTrial=Math.max(...result.architectures.flatMap(a=>a.trials.map(t=>t.meanRttMs)),.001);
  const [cs,p2p]=result.architectures;
  $('#comparison-results').innerHTML=`<div class="compare-cards">${result.architectures.map((a,index)=>`<article class="panel compare-card"><div class="compare-title-row"><div><span class="eyebrow">${index?'DISTRIBUTED MESSAGE ROUTING':'CENTRALIZED MESSAGE ROUTING'}</span><h2>${architecture(a.mode)}</h2></div><span class="architecture-icon">${index?'⌘':'⊙'}</span></div><div class="compare-metrics"><div><span>Mean application ACK RTT</span><b>${format(a.meanRttMs)} <small>ms</small></b></div><div><span>Acknowledged recipients</span><b>${a.acknowledged} <small>/ ${a.attempted}</small></b></div><div><span>Logical TCP connections</span><b>${a.logicalLinks}</b></div><div><span>Data-path application hops</span><b>${a.dataHops}</b></div></div><p class="chart-title">MEAN RTT BY TRIAL / ms</p><div class="trial-bars">${a.trials.map(t=>`<div class="trial-bar ${index?'p2p':'cs'}" style="height:${Math.max(5,t.meanRttMs/maxTrial*75)}px"><span>${format(t.meanRttMs,3)}</span></div>`).join('')}</div><div class="bar-labels">${a.trials.map(t=>`<span>Trial ${t.trial}</span>`).join('')}</div><div class="chart-footnote">Shared scale across both charts. Sequential workload, not bandwidth.</div></article>`).join('')}</div>
    <section class="panel comparison-table"><div class="panel-head"><h2>Failure isolation & recovery</h2><span class="tag">ACTUAL SOCKET SHUTDOWN</span></div><div class="table-scroll"><table><thead><tr><th>MEASUREMENT</th><th>CLIENT–SERVER</th><th>PEER-TO-PEER</th></tr></thead><tbody>
    <tr><td>Component removed</td><td>Central server (HUB)</td><td>Peer ${p2p.failure.removed}</td></tr>
    <tr><td>Healthy A → B delivery</td><td>${cs.failure.healthyDelivered} / 5</td><td>${p2p.failure.healthyDelivered} / 5</td></tr>
    <tr><td>Surviving A → B delivery after failure</td><td><span class="status failed">${cs.failure.survivorDelivered} / 5</span></td><td><span class="status delivered">${p2p.failure.survivorDelivered} / 5</span></td></tr>
    <tr><td>Reachable endpoint pairs after failure</td><td>${cs.failure.reachablePairsDuring}</td><td>${p2p.failure.reachablePairsDuring}</td></tr>
    <tr><td>Message to unavailable endpoint</td><td>${cs.failure.unavailableTargetStatus}</td><td>${p2p.failure.unavailableTargetStatus}</td></tr>
    <tr><td>Message after restoring failed component</td><td><span class="status ${cs.failure.recoveredStatus}">${cs.failure.recoveredStatus}</span></td><td><span class="status ${p2p.failure.recoveredStatus}">${p2p.failure.recoveredStatus}</span></td></tr>
    <tr><td>95th percentile application ACK RTT</td><td>${format(cs.p95RttMs)} ms</td><td>${format(p2p.p95RttMs)} ms</td></tr>
    </tbody></table></div></section>
    <div class="method-note"><span class="info-circle">i</span><p>A hub failure and a peer failure remove <strong>different roles</strong>. This test demonstrates dependence on the central routing service—not that all P2P systems are more reliable. The shared host/process and browser control server are not fault-isolated.</p></div>
    <div class="result-meta"><span>${date(result.timestamp)} · ${result.environment.node} · ${result.environment.platform} · ${result.config.messages} messages × ${result.config.trials} trials</span><button class="text-button" id="download-comparison">↓ Download complete results (JSON)</button></div>`;
}
async function loadHistory() {
  try{
    history=await get('/api/history');
    $('#history-list').innerHTML=history.length?history.map((item,index)=>`<article class="panel history-card"><div><h2>Architecture comparison · ${date(item.timestamp)}</h2><p>${item.config.count} endpoints · ${item.config.messages} messages / trial · ${item.config.trials} trials · ${item.config.payloadBytes}-byte payload</p><span class="history-id">EXPERIMENT ${item.id.slice(0,8).toUpperCase()} / ${item.environment.node} / ${item.environment.platform}</span></div><div class="history-actions"><button class="button" data-history-open="${index}">View results ↗</button><button class="button" data-history-export="${index}">↓ JSON</button></div></article>`).join(''):'<div class="empty-state large"><div class="empty-symbol">◷</div><h2>No experiments yet.</h2><p>Run a comparison. Its settings and measurements will be saved here.</p><button class="button" data-go-compare="true">Compare architectures ↗</button></div>';
  }catch(error){showError(error);}
}
function switchView(view) {
  if(!['lab','compare','history','guide'].includes(view))view='lab';
  currentView=view;
  $$('.view').forEach(section=>section.classList.toggle('hidden',section.id!==`view-${view}`));
  $$('[data-view]').forEach(link=>{link.classList.toggle('active',link.dataset.view===view);if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $('#breadcrumb-title').textContent={lab:'Live laboratory',compare:'Compare architectures',history:'Experiment history',guide:'Concept guide'}[view];
  if(view==='history')loadHistory();
}
function renderGuide(){
  $('#guide-content').innerHTML=`<div class="guide-grid">
    <article class="panel guide-card"><span class="eyebrow">01 / CLIENT–SERVER</span><h2>One central point of coordination.</h2><p>Every endpoint maintains a TCP connection to the hub. The hub receives a message, forwards it to the recipient, and relays the recipient's application ACK.</p><div class="concept-flow"><span>Node A</span><b>→</b><span>HUB</span><b>→</b><span>Node B</span></div><div class="formula">N endpoints → N TCP connections</div><p>For four clients, the model uses four persistent links. Stopping one client affects that client; stopping the hub prevents communication between all clients. This implementation has no replicated hub.</p></article>
    <article class="panel guide-card"><span class="eyebrow">02 / PEER-TO-PEER</span><h2>Endpoints communicate directly.</h2><p>Each peer runs a TCP listener and connects to every other peer. One bidirectional TCP connection is created for each unordered peer pair. No hub forwards peer messages.</p><div class="concept-flow"><span>Peer A</span><b>⇄</b><span>Peer B</span></div><div class="formula">N peers → N(N − 1) / 2 connections</div><p>Four peers need six links; eight need 28. A failed peer becomes unreachable, while surviving peers keep their existing connections. This is a fully connected mesh, not a distributed hash table or peer-discovery system.</p></article>
    <article class="panel guide-card guide-wide"><span class="eyebrow">03 / THE TWO PLANES</span><h2>The dashboard controls. The TCP network carries.</h2><div class="concept-flow"><span>Browser UI</span><b>HTTP + SSE ⇄</b><span>Local orchestrator</span><b>creates & observes →</b><span>TCP endpoints</span></div><p><strong>Control plane:</strong> browser actions use HTTP requests; server-sent events stream socket activity back to the UI. <strong>Data plane:</strong> DATA and application ACK frames cross real <code>node:net</code> sockets on <code>127.0.0.1</code>. The browser does not open raw TCP sockets. The HTTP server remains available when the demonstration's central TCP hub is stopped.</p></article>
    <article class="panel guide-card"><span class="eyebrow">04 / MESSAGE FRAMING</span><h2>TCP is a stream, not a mailbox.</h2><p>A TCP read can contain half a message, one message or several messages. NetScope buffers received UTF-8 text and splits complete newline-delimited JSON frames.</p><div class="formula">{ "kind": "DATA", ... } + "\\n"</div><p>Newlines inside a payload are escaped by JSON. UUIDs match each ACK to its pending message. Success means the sender received a recipient's application ACK; this is distinct from a TCP transport acknowledgement. Payloads are limited to 4096 UTF-8 bytes.</p></article>
    <article class="panel guide-card"><span class="eyebrow">05 / MEASUREMENTS</span><h2>What exactly are we measuring?</h2><p><strong>Application RTT:</strong> elapsed time from initiating a send until its application ACK returns. It includes serialization, socket transfer, event processing and configured teaching delay.</p><p><strong>Delivery success:</strong> acknowledged recipients ÷ intended recipients. A four-node broadcast expects three ACKs, including a failed outcome for an offline configured recipient.</p><p><strong>Teaching delay:</strong> explicit application scheduling before each DATA/ACK write—not packet loss or actual network latency. Node A → HUB → Node B → HUB → Node A has four teaching-delay applications. Visual packet animations are slowed for readability and are not a timing instrument.</p></article>
    <article class="panel guide-card guide-wide"><span class="eyebrow">06 / VIVA-READY DEMONSTRATION</span><h2>A reliable four-step demonstration.</h2><ol><li>Send A → B in client–server mode. Open the delivery log, Node B's inbox, and socket inspector.</li><li>Stop the central server and send again. Observe a failed delivery and zero reachable endpoint pairs. Restore the hub.</li><li>Switch to peer-to-peer, stop the final peer, and send A → B. Observe successful delivery between surviving peers; delivery to the offline peer fails.</li><li>Run a comparison. Explain the connection-count trade-off, measured RTT, failure test and local-only limitations.</li></ol><p>Switching architecture or applying configuration resets the live session. Completed experiments remain in history. The app works offline after Node.js is installed and does not require a database, account or internet API.</p></article>
    <article class="panel guide-card guide-wide"><span class="eyebrow">07 / SCOPE & REFERENCES</span><h2>A teaching laboratory—not a production network.</h2><p>All endpoints share one operating system and one Node.js process. The experiment has no LAN/WAN delays, packet capture, NAT traversal, encryption, authentication, distributed deployment or automatic hub failover. A process or machine failure can stop the whole lab. Localhost binding and origin validation reduce exposure, but are not production security.</p><p>Official implementation references: <a href="https://nodejs.org/api/net.html" target="_blank" rel="noreferrer">Node.js TCP networking</a> · <a href="https://nodejs.org/api/test.html" target="_blank" rel="noreferrer">Node.js test runner</a> · <a href="https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events" target="_blank" rel="noreferrer">MDN server-sent events</a>.</p></article>
  </div>`;
}

$('#sender').addEventListener('change',updateRecipients);
$('#message-text').addEventListener('input',()=>{
  const size=bytes($('#message-text').value);$('#byte-count').textContent=`${size} / 4096 bytes`;
  $('#message-text').setCustomValidity(size>4096?'Message exceeds 4096 UTF-8 bytes.':'');
});
$('#message-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const result=await post('/api/send',{from:$('#sender').value,to:$('#recipient').value,text:$('#message-text').value});
  if(result){const out=$('#send-result');out.className=`send-result ${result.status}`;
    out.textContent=result.status==='delivered'?`✓ ${result.delivered} / ${result.expected} recipient ACKs received.`:result.outcomes.filter(o=>!o.ok).map(o=>`${o.node}: ${o.reason}`).join(' · ');
  }
});
$$('[data-mode]').forEach(button=>button.addEventListener('click',async()=>{
  if(state.mode===button.dataset.mode)return;
  const result=await post('/api/reset',{mode:button.dataset.mode});
  if(result){$('#send-result').classList.add('hidden');notify(`${architecture(button.dataset.mode)} network ready. Live session reset.`);}
}));
$('#apply-config').addEventListener('click',async()=>{
  const result=await post('/api/reset',{count:Number($('#node-count').value),delayMs:Number($('#teaching-delay').value)});
  if(result){$('#send-result').classList.add('hidden');notify('Configuration applied. Live session reset.');}
});
$('#reset-network').addEventListener('click',()=>$('#reset-dialog').showModal());
$('#cancel-reset').addEventListener('click',()=>$('#reset-dialog').close());
$('#confirm-reset').addEventListener('click',async()=>{
  $('#reset-dialog').close();const result=await post('/api/reset',{});if(result){$('#send-result').classList.add('hidden');notify('Network reset. Saved experiments are unchanged.');}
});
$('#hub-toggle').addEventListener('click',async()=>{const up=!state.hub.up;if(await post('/api/hub',{up}))notify(up?'Central server restored.':'Central server stopped. Try sending a message.');});
$('#export-session').addEventListener('click',()=>{if(document.documentElement.dataset.hosted)cloudLab.export('json');else window.location.assign('/api/export?format=json');});
$('#export-csv').addEventListener('click',()=>{if(document.documentElement.dataset.hosted)cloudLab.export('csv');else window.location.assign('/api/export?format=csv');});
$('#run-comparison').addEventListener('click',async()=>{
  const result=await post('/api/compare',{count:Number($('#compare-count').value),messages:Number($('#compare-messages').value),trials:Number($('#compare-trials').value),delayMs:0});
  if(result){renderComparison(result);notify(result.storageWarning||'Comparison complete. Results saved to experiment history.');}
});
$('#refresh-history').addEventListener('click',loadHistory);
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));

document.addEventListener('click',async event=>{
  const preset=event.target.closest('[data-message]');if(preset){$('#message-text').value=preset.dataset.message;$('#message-text').dispatchEvent(new Event('input'));}
  const toggle=event.target.closest('[data-toggle-node]');if(toggle){const node=state.nodes.find(n=>n.id===toggle.dataset.toggleNode);if(await post('/api/node',{id:node.id,up:!node.up}))notify(`Node ${node.id} ${node.up?'stopped':'restored'}.`);}
  const inspect=event.target.closest('[data-inspect-node]');if(inspect){selectedNode=inspect.dataset.inspectNode;setTab('inbox');drawTopology();}
  const tab=event.target.closest('[data-tab]');if(tab)setTab(tab.dataset.tab);
  if(event.target.closest('#download-comparison')&&currentComparison)download(`netscope-comparison-${currentComparison.id.slice(0,8)}.json`,currentComparison);
  const open=event.target.closest('[data-history-open]');if(open){renderComparison(history[Number(open.dataset.historyOpen)]);location.hash='compare';}
  const exp=event.target.closest('[data-history-export]');if(exp){const item=history[Number(exp.dataset.historyExport)];download(`netscope-comparison-${item.id.slice(0,8)}.json`,item);}
  if(event.target.closest('[data-go-compare]'))location.hash='compare';
});
document.addEventListener('change',event=>{if(event.target.id==='inbox-node'){selectedNode=event.target.value;renderRecords();drawTopology();}});
document.addEventListener('keydown',event=>{
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-inspect-node]')){event.preventDefault();selectedNode=event.target.dataset.inspectNode;setTab('inbox');drawTopology();}
  if(event.target.matches('[data-tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const tabs=$$('[data-tab]');let index=tabs.indexOf(event.target);
    index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    tabs[index].focus();setTab(tabs[index].dataset.tab);
  }
});
function setTab(tab){recordTab=tab;$$('[data-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.tab===tab);button.setAttribute('aria-selected',button.dataset.tab===tab);button.tabIndex=button.dataset.tab===tab?0:-1;});renderRecords();}
async function init(){
  renderGuide();switchView(location.hash.slice(1)||'lab');$('#message-text').dispatchEvent(new Event('input'));updateBusy();
  try{
    state=await get('/api/state');$('#node-count').value=String(state.count);$('#teaching-delay').value=String(state.delayMs);render();
    if(document.documentElement.dataset.hosted){$('#connection-dot').className='online';$('#connection-label').textContent='Cloud TCP engine ready';return;}
    stream=new EventSource('/api/events');
    stream.onopen=()=>{$('#connection-dot').className='online';$('#connection-label').textContent='Local engine connected';};
    stream.onerror=()=>{$('#connection-dot').className='offline';$('#connection-label').textContent='Reconnecting to engine…';};
    stream.addEventListener('state',event=>{state=JSON.parse(event.data);render();});
    stream.addEventListener('network',event=>{const detail=JSON.parse(event.data);animateHop(detail);});
    stream.addEventListener('comparison',event=>{renderComparison(JSON.parse(event.data));if(currentView==='history')loadHistory();});
    history=await get('/api/history');if(history.length)renderComparison(history[0]);
  }catch(error){showError(new Error(`${document.documentElement.dataset.hosted?'Cannot reach the cloud engine. Try again.':'Cannot reach the local engine. Start it with npm start.'} ${error.message}`));$('#connection-label').textContent='Engine offline';}
}
init();
