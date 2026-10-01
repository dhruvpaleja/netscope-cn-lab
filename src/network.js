import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { attachFraming, encodeFrame } from './framing.js';

const HOST = '127.0.0.1';
const LIMITS = { nodes: [3, 8], delay: [0, 200], payload: 4096 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = number => Math.round(number * 1000) / 1000;
const percentile = (values, p) => values.length ? [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;

export function validateConfig({ mode, count, delayMs }) {
  if (!['client-server', 'peer-to-peer'].includes(mode)) throw new Error('Choose a valid architecture');
  if (!Number.isInteger(count) || count < 3 || count > 8) throw new Error('Node count must be an integer from 3 to 8');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 200) throw new Error('Teaching delay must be an integer from 0 to 200 ms');
}

/**
 * One Node.js process orchestrates distinct logical hosts. Every DATA and ACK
 * message crosses real loopback TCP sockets; HTTP/SSE only control and observe.
 * This is not a WAN benchmark and the optional delay is application-level.
 */
export class NetworkLab extends EventEmitter {
  constructor({ mode = 'client-server', count = 4, delayMs = 0 } = {}) {
    super();
    validateConfig({mode, count, delayMs});
    this.mode = mode; this.count = count; this.delayMs = delayMs;
    this.sockets = new Set(); this.servers = new Set(); this.timers = new Set();
    this.nodes = new Map(); this.hub = { up: false, port: null, server: null, clients: new Map() };
    this.pending = new Map(); this.events = []; this.messages = []; this.sequence = 0;
    this.generation = 0; this.ready = false;
    this.resetMetrics();
  }

  resetMetrics() {
    this.stats = { attempts: 0, expected: 0, acknowledged: 0, failed: 0, transmissions: 0, wireBytes: 0, payloadBytes: 0, rtts: [], hubForwards: 0 };
  }

  log(type, text, detail = {}) {
    const event = { id: ++this.sequence, timestamp: new Date().toISOString(), type, text, ...detail };
    this.events.push(event);
    if (this.events.length > 1500) this.events.shift();
    this.emit('event', event);
    this.emit('change');
    return event;
  }

  track(socket) {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    return socket;
  }

  async listen(handler) {
    const server = net.createServer(socket => handler(this.track(socket)));
    this.servers.add(server);
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      server.once('error', onError);
      server.listen(0, HOST, () => { server.removeListener('error', onError); resolve(); });
    });
    server.on('error', error => this.log('error', `TCP listener: ${error.message}`));
    return server;
  }

  async connect(port, onFrame, hello) {
    const socket = this.track(new net.Socket());
    attachFraming(socket, onFrame, error => {
      if (this.ready) this.log('error', `TCP connection: ${error.message}`);
    });
    await new Promise((resolve, reject) => {
      const fail = error => reject(error);
      socket.once('error', fail);
      socket.connect(port, HOST, () => {
        socket.removeListener('error', fail);
        socket.write(encodeFrame(hello));
        resolve();
      });
    });
    return socket;
  }

  async start() {
    this.ready = false;
    for (let i = 0; i < this.count; i++) {
      const id = String.fromCharCode(65 + i);
      this.nodes.set(id, { id, name: `Node ${id}`, up: true, port: null, listener: null, hubSocket: null, links: new Map(), sent: 0, received: 0, inbox: [] });
    }
    if (this.mode === 'client-server') await this.startHub();
    else await this.startMesh();
    this.ready = true;
    this.log('system', `${this.mode === 'client-server' ? 'Client-server' : 'Peer-to-peer'} network ready: ${this.count} endpoints`, { mode: this.mode });
    return this.snapshot();
  }

  async waitFor(predicate, message = 'TCP registration timed out') {
    const deadline = performance.now() + 2500;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(message);
      await sleep(4);
    }
  }

  async startHub() {
    this.hub.clients = new Map();
    this.hub.server = await this.listen(socket => {
      let identity = null;
      attachFraming(socket, frame => {
        if (frame.kind === 'HELLO' && !identity && this.nodes.has(frame.from)) {
          if (this.hub.clients.has(frame.from)) { socket.destroy(); return; }
          identity = frame.from;
          this.hub.clients.set(identity, socket);
          socket.once('close', () => {
            if (this.hub.clients.get(identity) === socket) this.hub.clients.delete(identity);
          });
          return;
        }
        if (!identity || frame.from !== identity || !this.nodes.get(identity)?.up) { socket.destroy(); return; }
        if (frame.kind === 'DATA') this.forwardData(frame);
        else if (frame.kind === 'ACK') this.forwardAck(frame);
      }, error => { if (this.ready) this.log('error', error.message); });
    });
    this.hub.port = this.hub.server.address().port; this.hub.up = true;
    for (const node of this.nodes.values()) if (node.up) await this.connectToHub(node);
    await this.waitFor(() => this.hub.clients.size === [...this.nodes.values()].filter(n => n.up).length);
  }

  async connectToHub(node) {
    node.hubSocket = await this.connect(this.hub.port, frame => {
      if (frame.kind === 'DATA') this.receiveData(node.id, frame);
      else if (frame.kind === 'ACK') this.receiveAck(node.id, frame);
    }, { kind: 'HELLO', from: node.id });
    node.port = node.hubSocket.localPort;
  }

  async startMesh() {
    for (const node of this.nodes.values()) if (node.up) await this.listenPeer(node);
    const nodes = [...this.nodes.values()].filter(n => n.up);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) await this.connectPeers(nodes[i], nodes[j]);
    }
    await this.waitFor(() => nodes.every(n => n.links.size === nodes.length - 1));
  }

  async listenPeer(node) {
    node.listener = await this.listen(socket => {
      let identity = null;
      attachFraming(socket, frame => {
        if (frame.kind === 'HELLO' && !identity && frame.from !== node.id && this.nodes.get(frame.from)?.up) {
          if (node.links.has(frame.from)) { socket.destroy(); return; }
          identity = frame.from; node.links.set(identity, socket);
          socket.once('close', () => {
            if (node.links.get(identity) === socket) node.links.delete(identity);
          });
          return;
        }
        if (!identity || frame.from !== identity || frame.to !== node.id) { socket.destroy(); return; }
        if (frame.kind === 'DATA') this.receiveData(node.id, frame);
        else if (frame.kind === 'ACK') this.receiveAck(node.id, frame);
      }, error => { if (this.ready) this.log('error', error.message); });
    });
    node.port = node.listener.address().port;
  }

  async connectPeers(a, b) {
    const socket = await this.connect(b.port, frame => {
      if (frame.from !== b.id || frame.to !== a.id) return;
      if (frame.kind === 'DATA') this.receiveData(a.id, frame);
      else if (frame.kind === 'ACK') this.receiveAck(a.id, frame);
    }, { kind: 'HELLO', from: a.id });
    a.links.set(b.id, socket);
    socket.once('close', () => { if (a.links.get(b.id) === socket) a.links.delete(b.id); });
    await this.waitFor(() => b.links.has(a.id));
  }

  writeHop(socket, frame, from, to, onFailure = () => {}) {
    const generation = this.generation;
    const write = () => {
      if (generation !== this.generation) return;
      if (!socket || socket.destroyed || !socket.writable) { onFailure(); return; }
      const encoded = encodeFrame(frame);
      this.stats.transmissions++; this.stats.wireBytes += Buffer.byteLength(encoded);
      socket.write(encoded, error => { if (error) onFailure(); });
      this.log(frame.kind === 'ACK' ? 'ack-hop' : 'data-hop', `${frame.kind} ${from} → ${to}`, { from, to, messageId: frame.id, bytes: Buffer.byteLength(encoded) });
    };
    if (this.delayMs) {
      const timer = setTimeout(() => { this.timers.delete(timer); write(); }, this.delayMs);
      this.timers.add(timer);
    } else write();
  }

  forwardData(frame) {
    const pending = this.pending.get(frame.id);
    if (!pending || !this.hub.up) return;
    // A broadcast is sent once to the hub; the hub performs the fan-out.
    for (const target of pending.targets) {
      if (pending.outcomes.has(target)) continue;
      this.stats.hubForwards++;
      this.writeHop(this.hub.clients.get(target), { ...frame, to: target }, 'HUB', target, () => this.markFailure(frame.id, target, 'Receiver disconnected'));
    }
  }

  forwardAck(frame) {
    if (!this.pending.has(frame.id) || !this.hub.up) return;
    this.stats.hubForwards++;
    this.writeHop(this.hub.clients.get(frame.to), frame, 'HUB', frame.to);
  }

  receiveData(id, frame) {
    const node = this.nodes.get(id);
    if (!node?.up || !this.pending.has(frame.id)) return;
    node.received++;
    node.inbox.unshift({ id: frame.id, from: frame.from, text: frame.text, timestamp: new Date().toISOString() });
    node.inbox = node.inbox.slice(0, 50);
    this.log('received', `${id} received a message from ${frame.from}`, { from: frame.from, to: id, messageId: frame.id, textPreview: frame.text.slice(0, 90) });
    const ack = { kind: 'ACK', id: frame.id, from: id, to: frame.from };
    if (this.mode === 'client-server') this.writeHop(node.hubSocket, ack, id, 'HUB');
    else this.writeHop(node.links.get(frame.from), ack, id, frame.from);
  }

  receiveAck(id, frame) {
    const pending = this.pending.get(frame.id);
    if (!pending || pending.from !== id || !pending.targets.includes(frame.from) || pending.outcomes.has(frame.from)) return;
    const rttMs = round(performance.now() - pending.started);
    pending.outcomes.set(frame.from, { node: frame.from, ok: true, rttMs, route: this.mode === 'client-server' ? [id, 'HUB', frame.from] : [id, frame.from] });
    this.stats.acknowledged++; this.stats.rtts.push(rttMs);
    this.stats.payloadBytes += Buffer.byteLength(pending.text);
    this.log('delivered', `Delivery acknowledged: ${id} → ${frame.from} (${rttMs.toFixed(2)} ms RTT)`, { from: id, to: frame.from, messageId: frame.id, rttMs });
    this.finishIfComplete(frame.id);
  }

  markFailure(id, target, reason) {
    const pending = this.pending.get(id);
    if (!pending || pending.outcomes.has(target)) return;
    pending.outcomes.set(target, { node: target, ok: false, reason, rttMs: null });
    this.stats.failed++;
    this.log('failure', `Delivery failed: ${pending.from} → ${target}: ${reason}`, { from: pending.from, to: target, messageId: id });
    this.finishIfComplete(id);
  }

  finishIfComplete(id) {
    const pending = this.pending.get(id);
    if (!pending || pending.outcomes.size !== pending.targets.length) return;
    clearTimeout(pending.timer);
    const outcomes = pending.targets.map(target => pending.outcomes.get(target));
    const delivered = outcomes.filter(o => o.ok).length;
    const message = {
      id, timestamp: pending.timestamp, mode: this.mode, from: pending.from, to: pending.to,
      text: pending.text, bytes: Buffer.byteLength(pending.text), outcomes,
      delivered, expected: outcomes.length,
      status: delivered === outcomes.length ? 'delivered' : delivered ? 'partial' : 'failed'
    };
    this.messages.unshift(message); this.messages = this.messages.slice(0, 500);
    this.pending.delete(id); pending.resolve(message); this.emit('change');
  }

  async send({ from, to, text }) {
    if (!this.ready) throw new Error('Network is not ready');
    if (!this.nodes.has(from)) throw new Error('Unknown sender');
    if (to !== 'ALL' && !this.nodes.has(to)) throw new Error('Unknown recipient');
    if (from === to) throw new Error('Sender and recipient must be different');
    if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a non-empty message');
    if (Buffer.byteLength(text, 'utf8') > LIMITS.payload) throw new Error('Message exceeds 4096 UTF-8 bytes');
    if (this.pending.size >= 100) throw new Error('Too many pending messages');
    const targets = to === 'ALL' ? [...this.nodes.keys()].filter(id => id !== from) : [to];
    const id = randomUUID(); const sender = this.nodes.get(from);
    this.stats.attempts++; this.stats.expected += targets.length; sender.sent++;
    let resolve;
    const completion = new Promise(r => { resolve = r; });
    const pending = { from, to, text, targets, outcomes: new Map(), resolve, started: performance.now(), timestamp: new Date().toISOString() };
    pending.timer = setTimeout(() => targets.forEach(target => this.markFailure(id, target, 'Application ACK timed out')), Math.max(1500, this.delayMs * 6 + 1200));
    this.pending.set(id, pending);
    this.log('send', `${from} sent ${to === 'ALL' ? 'a broadcast' : `to ${to}`}`, { from, to, messageId: id });
    const frame = { kind: 'DATA', id, from, to, text };
    if (!sender.up) {
      targets.forEach(target => this.markFailure(id, target, 'Sender is offline')); return completion;
    }
    if (this.mode === 'client-server' && !this.hub.up) {
      targets.forEach(target => this.markFailure(id, target, 'Central server is offline')); return completion;
    }
    for (const target of targets) {
      if (!this.nodes.get(target).up) this.markFailure(id, target, 'Recipient is offline');
    }
    if (this.pending.has(id)) {
      if (this.mode === 'client-server') this.writeHop(sender.hubSocket, frame, from, 'HUB', () => targets.forEach(target => this.markFailure(id, target, 'Server connection unavailable')));
      else for (const target of targets) {
        if (!pending.outcomes.has(target)) this.writeHop(sender.links.get(target), { ...frame, to: target }, from, target, () => this.markFailure(id, target, 'Peer connection unavailable'));
      }
    }
    return completion;
  }

  async closeListener(server) {
    if (!server) return;
    this.servers.delete(server);
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }

  async setHub(up) {
    if (this.mode !== 'client-server') throw new Error('Peer-to-peer mode has no central data server');
    if (this.pending.size) throw new Error('Wait for pending messages before changing topology');
    if (this.hub.up === up) return this.snapshot();
    if (!up) {
      this.hub.up = false;
      for (const node of this.nodes.values()) node.hubSocket?.destroy();
      for (const socket of this.hub.clients.values()) socket.destroy();
      this.hub.clients.clear(); await this.closeListener(this.hub.server);
      this.log('failure', 'Central server stopped: all hub-mediated communication is unavailable');
    } else { await this.startHub(); this.log('recovery', 'Central server restored and active clients reconnected'); }
    this.emit('change'); return this.snapshot();
  }

  async setNode(id, up) {
    const node = this.nodes.get(id);
    if (!node) throw new Error('Unknown node');
    if (this.pending.size) throw new Error('Wait for pending messages before changing topology');
    if (node.up === up) return this.snapshot();
    node.up = up;
    if (!up) {
      node.hubSocket?.destroy(); this.hub.clients.get(id)?.destroy(); this.hub.clients.delete(id);
      for (const socket of node.links.values()) socket.destroy(); node.links.clear();
      for (const other of this.nodes.values()) { other.links.get(id)?.destroy(); other.links.delete(id); }
      await this.closeListener(node.listener);
      this.log('failure', `Node ${id} stopped; its TCP connections were closed`, { node: id });
    } else {
      if (this.mode === 'client-server' && this.hub.up) {
        await this.connectToHub(node); await this.waitFor(() => this.hub.clients.has(id));
      } else if (this.mode === 'peer-to-peer') {
        await this.listenPeer(node);
        for (const other of this.nodes.values()) if (other.id !== id && other.up) await this.connectPeers(node, other);
      }
      this.log('recovery', `Node ${id} restored`, { node: id });
    }
    this.emit('change'); return this.snapshot();
  }

  snapshot() {
    const nodes = [...this.nodes.values()].map(node => ({
      id: node.id, name: node.name, up: node.up, port: node.port,
      connected: node.up && (this.mode === 'client-server' ? this.hub.up && !!node.hubSocket && !node.hubSocket.destroyed : true),
      sent: node.sent, received: node.received, inbox: node.inbox
    }));
    const links = [];
    if (this.mode === 'client-server') {
      for (const node of this.nodes.values()) links.push({ from: node.id, to: 'HUB', up: node.up && this.hub.up && !!node.hubSocket && !node.hubSocket.destroyed });
    } else {
      const ids = [...this.nodes.keys()];
      for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) {
        const a = this.nodes.get(ids[i]), b = this.nodes.get(ids[j]);
        links.push({ from: a.id, to: b.id, up: a.up && b.up && !!a.links.get(b.id) && !a.links.get(b.id).destroyed });
      }
    }
    const rtts = this.stats.rtts;
    const active = nodes.filter(n => n.up).length;
    const reachablePairs = this.mode === 'client-server' && !this.hub.up ? 0 : active * (active-1) / 2;
    return {
      mode: this.mode, count: this.count, delayMs: this.delayMs, ready: this.ready,
      nodes, links, hub: { up: this.hub.up, port: this.hub.port }, pending: this.pending.size,
      stats: { ...this.stats, rtts: undefined, meanRttMs: rtts.length ? round(rtts.reduce((a,b)=>a+b,0)/rtts.length) : null,
        p95RttMs: percentile(rtts, .95), successPct: this.stats.expected ? round(this.stats.acknowledged/this.stats.expected*100) : null,
        activeLinks: links.filter(l=>l.up).length, reachablePairs, totalPairs: this.count*(this.count-1)/2,
        meanDataHops: this.mode === 'client-server' ? 2 : 1 },
      messages: this.messages, events: this.events.slice(-300), generation: this.generation
    };
  }

  async stop() {
    this.ready = false; this.generation++;
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    for (const [id,pending] of this.pending) for (const target of pending.targets) this.markFailure(id, target, 'Network stopped');
    for (const socket of this.sockets) socket.destroy(); this.sockets.clear();
    await Promise.all([...this.servers].map(server => this.closeListener(server)));
    this.nodes.clear(); this.hub = { up: false, port: null, server: null, clients: new Map() };
  }

  async reset(config = {}) {
    const next = { mode: config.mode ?? this.mode, count: config.count ?? this.count, delayMs: config.delayMs ?? this.delayMs };
    validateConfig(next);
    await this.stop(); Object.assign(this, next);
    this.messages = []; this.events = []; this.sequence = 0; this.resetMetrics();
    return this.start();
  }
}
