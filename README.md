# Hosted edition (Vercel)

The Vercel build serves the complete UI and `api/cloud.js`. Each action creates isolated real loopback TCP sockets, executes the experiment, and closes the sockets. No persistent server, database, or shared in-memory user state is needed. Port labels describe the latest experiment; sockets do not remain open between requests. Message history and comparison results are held in the current browser tab; export them before refreshing. Hosted session retains 200 messages, 300 events, and 10 comparisons. RTT summaries cover retained messages; delivery counters cover the session. `npm start` retains the original continuous local lab.

Deploy using framework **Other**, build command `npm run build`, output directory `dist`, Node.js 22+. No environment variables required.

# NetScope — Network Architecture Lab

**Official mini-project topic:** Simulate Peer-to-Peer vs Client-Server Architecture  
**Subject:** Computer Networks · Unit 1 · B2 / Group 1  
**Team:** Dhruv Paleja (I081), Manan Shah (I053), Armaan Lad (I076)  
**Submission package:** 1 October 2026

A complete local web application that demonstrates **actual TCP communication**, not just animated topology diagrams. Switch between a central relay and a fully connected peer mesh; send messages, inspect received payloads and socket addresses, stop endpoints, restore them, run comparisons and export evidence.

## Start in under a minute

Install **Node.js 22 or newer** if it is not already installed. A supported Node.js LTS release is suitable: https://nodejs.org/en/download

Extract the ZIP first. Open a terminal **inside the NetScope_Project folder**, then run:

```sh
node --version
npm start
```

Open **http://127.0.0.1:3000** in a browser. Keep the terminal open. Press `Ctrl+C` to stop the server.

**No `npm install` is needed for the application or its Node tests.** There are no npm runtime dependencies, API keys, accounts, cloud services or databases to configure. The app can operate offline after Node.js is installed. Double-clicking `index.html` will not start the TCP engine.

Alternative launchers:

- Windows: double-click `start-windows.bat`.
- macOS/Linux: run `sh start-mac-linux.sh` from the extracted folder.

## Features that actually work

| Feature | Implementation |
|---|---|
| Client–server mode | Persistent TCP connection from each client to a central message-forwarding hub |
| Peer-to-peer mode | A TCP listener per peer and one persistent bidirectional connection per unordered pair |
| Unicast and broadcast | Real newline-delimited JSON DATA frames and per-recipient application ACKs |
| Live visualization | SVG topology; events originate in socket operations; animation is slowed for readability |
| Fault laboratory | Closes actual hub or peer sockets; restores listeners and reconnects endpoints |
| Inspectors | Delivery log, per-node received-message inbox and actual OS-assigned socket ports |
| Metrics | Recipient ACK success rate, application ACK RTT, logical links and reachable pairs |
| Configuration | 3–8 endpoints; explicit 0/20/50/100 ms per-application-hop teaching-delay options |
| Comparison | Fresh sockets, warm-up exclusion, alternating trial order, identical workload and failure probes |
| History and export | Last 30 comparisons saved locally; session JSON, comparison JSON and message CSV exports |
| UI/UX | Responsive desktop/mobile layout, keyboard-accessible nodes/tabs, reset confirmation, errors and busy states |

## A five-minute viva demonstration

1. Leave the default **client–server** mode. Send A → B. Open Node B's inbox and the socket inspector. Explain that the path is A → HUB → B; the application ACK returns through HUB.
2. Send a broadcast. For four configured nodes, the sender expects three recipient ACKs. The sender does not receive its own broadcast.
3. Stop the central server. Send A → B again: delivery fails. Restore the server and repeat: delivery succeeds.
4. Switch to **peer-to-peer**. Six persistent links are created for four peers. Stop D, then send A → B: the surviving pair still communicates. A → D fails. Restore D.
5. Open **Compare architectures** and run the default experiment. Explain the recorded results and limitations. Open history and export the JSON.

## Verification

```sh
npm test
npm run evidence
```

`npm test` runs the built-in Node test suite, including real TCP, HTTP and native SSE integration. The packaged run recorded **41 tests passed, 0 failed**. `npm run evidence` creates fresh result JSON files in `evidence/`; timing values will vary by run.

The build also recorded **30 UI checks passed** in Chromium. The build environment restricted direct browser navigation, so these checks loaded the unmodified production HTML/CSS/JS and bridged API requests to the actual local Node engine. Native SSE is tested separately by the Node suite. This is not a claim of a direct-navigation browser end-to-end run. See `evidence/ui-test-report.json`.

Optional reproduction of the build UI checks requires **Python, Playwright and a compatible Chromium binary**, separate from the application's zero-dependency setup. Start `npm start` first, then run `python tests/ui_checks.py`. Set `CHROMIUM_PATH` and `NETSCOPE_URL` when the defaults do not match your machine. This optional harness is not required to run or present the project.

## What the architecture does—and does not—mean

All network endpoints run on **one operating system in one Node.js process**, but exchange DATA and ACK frames through distinct real TCP sockets on IPv4 loopback (`127.0.0.1`). The browser uses HTTP to issue commands and server-sent events to observe activity. It does not open raw TCP sockets.

The **HTTP control server** and the **central TCP data hub** are different services. Stopping the demonstration hub does not stop the dashboard. P2P messages bypass the data hub, but peer creation and observation remain centrally orchestrated. A process or host failure can stop the entire lab.

The P2P model is a full mesh, not every possible P2P architecture. There is no NAT traversal, peer discovery, multihop routing, encryption, user authentication or production failover. Keep it local. The server intentionally binds to loopback only.

### Metric definitions

- **Expected recipients:** all configured intended targets, including an offline target. Broadcast excludes the sender.
- **Success:** the sender receives the recipient's application ACK. A TCP transport ACK alone is not the success criterion.
- **Application RTT:** monotonic elapsed time from initiating a send until its application ACK returns. It includes serialization, logging, scheduling and any explicit teaching delay.
- **Link count:** persistent logical TCP connections, not TCP segments or physical cables. A bidirectional connection counts once.
- **Data hops:** application forwarding legs: 2 through the hub, 1 for direct peers. They are not IP-router hop counts.
- **Reachable pairs:** unordered configured endpoint pairs that can currently communicate in this fully connected model.
- **`stats.wireBytes`:** UTF-8 bytes of serialized DATA/ACK application frames written across all logical hops. It excludes registration frames and TCP/IP/link-layer headers; it is **not** a packet-capture byte count or bandwidth measure.

Teaching delay is implemented before each DATA/ACK socket write. With delay `d`, a unicast adds approximately `4d` in client–server mode and `2d` in P2P mode, plus application work. Comparison experiments always use zero teaching delay from the UI. Animated dots use a fixed readable display duration and are not a latency measurement.

## Project layout

```text
NetScope_Project/
  server.js                       HTTP API, static assets, SSE, history storage
  src/network.js                  Real TCP hub and peer-mesh engine
  src/framing.js                  Bounded newline-delimited JSON decoder
  src/experiments.js               Repeated workload and failure/recovery probes
  public/index.html               Complete application UI
  public/styles.css               Responsive visual system
  public/app.js                   UI state, controls, inspection and exports
  tests/*.test.js                 Built-in Node automated tests
  tests/browser_harness.py        Optional build UI verification adapter
  tests/ui_checks.py              Optional browser workflow checks
  scripts/collect-evidence.js     Reproduce measured result files
  evidence/                      Actual test logs, JSON and UI screenshots
  docs/                          Project report, PPT, API guide, viva and audit
  data/experiments.json           Created at runtime; last 30 comparisons
  start-windows.bat               Windows launcher
  start-mac-linux.sh              macOS/Linux launcher
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node` or `npm` is not recognized | Install Node.js and reopen the terminal. |
| Cannot reach the engine | Start the server in the extracted project folder and use the address printed in the terminal. |
| Port 3000 is busy | macOS/Linux: `PORT=3001 npm start`. PowerShell: `$env:PORT=3001; npm start`. Windows CMD: `set PORT=3001&& npm start`. Open port 3001. |
| Data disappears after switching modes | Expected: a mode/configuration change creates a fresh live session. Saved comparisons remain in history. |
| Comparison is slower with more messages | The workload is sequential and intentional. Wait for completion before another mutation. |
| Socket port changes after recovery | Expected: the operating system selects ephemeral ports when listeners or connections are recreated. |
| Results differ from the report | Expected: recorded RTT depends on the machine, scheduling and logging. Use the same settings and report your new measured values. |
| A firewall prompt appears | This is a loopback-only local lab. Do not expose it publicly or grant unnecessary external access. |

## Topic availability

The selected topic is **Project 1** in `Mini_Projects.xlsx`, Sheet1!B6:B7. All populated topic cells in both tabs of `CN Groups List.xlsx` were checked. It was not listed as assigned in that uploaded snapshot. A local selected-copy workbook is supplied; no live shared group sheet has been reserved or changed. Full audit: `docs/TOPIC_SELECTION.md`.

## References

Node TCP networking: https://nodejs.org/api/net.html  
Node test runner: https://nodejs.org/api/test.html  
MDN server-sent events: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events  
Node releases: https://nodejs.org/en/about/previous-releases
