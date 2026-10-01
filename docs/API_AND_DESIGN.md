# NetScope — implementation and API guide

All HTTP endpoints are served on `http://127.0.0.1:3000` by default. The service accepts localhost/127.0.0.1 Host values, rejects cross-origin writes, limits request bodies to 16 KiB and serves only allowlisted static assets. POST bodies must be JSON. There is no production user authentication: do not expose the app to untrusted networks.

| Method | Path | Body / meaning |
|---|---|---|
| GET | `/api/state` | Architecture, endpoint state, actual ports, metrics, messages and recent events |
| GET | `/api/events` | Native `text/event-stream` events: `state`, `network`, `comparison`; heartbeat comments |
| POST | `/api/reset` | Optional `{ "mode":"peer-to-peer", "count":4, "delayMs":0 }`; resets session |
| POST | `/api/send` | `{ "from":"A", "to":"B", "text":"Hello" }`; `"ALL"` broadcasts |
| POST | `/api/hub` | `{ "up":false }` stops central data hub; valid only in client–server mode |
| POST | `/api/node` | `{ "id":"D", "up":false }` stops a configured endpoint |
| POST | `/api/compare` | `{ "count":4, "messages":30, "trials":3, "delayMs":0 }` |
| GET | `/api/history` | Latest 30 completed comparisons |
| GET | `/api/export?format=json` | Full current session and history download |
| GET | `/api/export?format=csv` | Current live message log download |

The HTTP mutation guard allows one action at a time and returns HTTP 409 for overlap. The core engine can track multiple pending messages by UUID and is independently tested with concurrent sends. A comparison creates isolated temporary lab objects and does not overwrite the live laboratory topology.

## Module responsibilities

`server.js` serves static files, validates HTTP requests, guards mutations, streams live observations, and saves history using a temporary file followed by rename.

`src/network.js` creates listeners/connections, authenticates a peer's declared identity only against the local registration map (not cryptographic authentication), frames and routes DATA/ACK, tracks outcomes, performs actual fault shutdowns and recreates sockets during recovery.

`src/framing.js` treats TCP as a stream. It buffers incomplete frames, parses complete JSON lines, and rejects malformed/non-object/oversized frames. UTF-8 decoding uses Node's stream decoder via `setEncoding('utf8')`.

`src/experiments.js` performs identical repeated sequential workloads and records each successful recipient RTT. Three warm-up messages are excluded per trial; the first architecture alternates by trial. It then probes healthy, failed and recovered networks.

`public/app.js` consumes API and SSE data. User message strings are escaped before HTML rendering. Numeric configuration is server-validated. Payloads are limited by UTF-8 byte length, not just character count.

## Data-plane frame schemas

```json
{"kind":"HELLO","from":"A"}
{"kind":"DATA","id":"uuid","from":"A","to":"B","text":"Hello"}
{"kind":"ACK","id":"same-uuid","from":"B","to":"A"}
```

Each JSON object is followed by one newline. Registration uses HELLO. The teaching metrics count DATA and ACK frames, not HELLO or physical TCP/IP headers. The central hub expands a broadcast into per-recipient DATA sends; direct peers perform the fan-out themselves. The implementation does not use UDP broadcast.

## Message lifecycle

1. Validate sender, target, non-empty payload and UTF-8 size.
2. Determine configured recipients and register a UUID-keyed pending record.
3. Fail known unavailable targets explicitly; do not remove them from the denominator.
4. Serialize and write DATA through the selected topology.
5. The actual receiver records the decoded payload in its inbox and writes an ACK.
6. The original sender matches the ACK UUID and recipient to the pending record, measures elapsed time and completes when all recipients have a terminal outcome.
7. A bounded application timeout marks missing ACKs as failed. A failed outcome with a timeout is not proof that the receiver never saw the payload; inspect receipt events/inboxes when diagnosing it.

## Topology formulas

For `N` endpoints: star connections = `N`; full-mesh connections = `N(N−1)/2`. For `K` online endpoints with functioning routing, reachable unordered pairs = `K(K−1)/2`. A failed hub makes the star's reachable-pair count zero. In this controlled full mesh, surviving peers retain all mutual connections.

Client–server unicast uses 2 DATA writes and 2 ACK writes. P2P unicast uses 1 of each. For a healthy four-node broadcast, the hub model uses 10 DATA/ACK writes (1 ingress DATA, 3 egress DATA, 3 ingress ACK, 3 egress ACK); direct peers use 6. These are application socket writes, not counted physical packets.

## State retention

Latest 500 messages; latest 50 received messages per node; latest 1500 internal events, with 300 recent events in state snapshots and 60 shown in the stream panel. Metrics are session totals. Comparisons are persisted locally, at most 30 entries. Restart or reset clears live logs. Ports are ephemeral and may change.

## Security and deployment boundary

Loopback binding, host/origin checks, input bounds, safe UI escaping, security headers and a strict asset map are included. They do not make this a secure multi-user service. There is no TLS, secret-based node authentication, authorization, peer identity trust, network isolation, NAT traversal or LAN mode. Keep the default localhost-only scope.
