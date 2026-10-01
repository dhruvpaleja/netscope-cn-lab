# NetScope — slide-wise presentation script

Suggested main presentation: approximately 8–10 minutes, plus a short live demonstration. Slides 13–14 are backup/reference slides. Speak in your own words; use the app to explain the evidence.

## Slide 1 — Dhruv Paleja

Good morning. Our project is NetScope, based on the topic “Simulate Peer-to-Peer vs Client-Server Architecture.” Rather than only drawing the networks, we built a local application in which messages actually cross TCP sockets. We can observe their routes, stop network components, restore them, and compare measured outcomes. Our group consists of Dhruv Paleja, Manan Shah and Armaan Lad.

## Slide 2 — Dhruv Paleja

We wanted to answer three practical questions. First, where does a message travel? Second, what stops working when a component goes offline? Third, what does the architecture cost in connections and application delay? The left model routes every client message through a hub. The right model creates direct connections between peers. We use the same type of message in both models so we can compare the architecture rather than two unrelated applications.

## Slide 3 — Dhruv Paleja

The browser is the control plane. It sends HTTP commands and receives server-sent events. The Node engine creates the actual TCP listeners and connections. DATA and application acknowledgements cross those TCP sockets, not a JavaScript animation shortcut. All addresses use localhost, so the endpoints share one process and operating system. This is an honest teaching setup, not a claim that we deployed separate computers. Also, the HTTP interface is separate from the TCP hub that we stop during the failure demonstration.

## Slide 4 — Dhruv Paleja

This is the working interface. We choose the architecture here, select a sender and recipient, enter a payload and transmit. The fault controls stop actual components. Below the topology we can inspect deliveries, received payloads and socket addresses. There is also a comparison page and saved experiment history. The layout works on desktop and mobile, and the interface reports errors and partial delivery instead of presenting every action as successful. I will now hand over to Manan for the communication logic.

## Slide 5 — Manan Shah

In client–server mode, each client maintains a persistent connection to the hub. For an A-to-B message, A writes DATA to the hub and the hub writes it to B. B records the decoded payload and replies with an application ACK. The hub forwards that ACK to A. That is two DATA writes and two ACK writes. These are application forwarding legs, not IP router hops or counted physical TCP packets. The receiver ACK is also different from TCP transport acknowledgements.

## Slide 6 — Manan Shah

In peer-to-peer mode, each peer listens for TCP connections and the engine creates one connection for each unordered pair. A sends directly to B and B acknowledges directly to A, so the data hub is not part of that message path. The trade-off is connection count: a full mesh needs N times N minus one divided by two connections. Four peers require six links, while eight require twenty-eight. We divide by two because a bidirectional A–B connection is the same connection as B–A.

## Slide 7 — Manan Shah

TCP is a byte stream, so a read can contain part of a message or several messages. We serialize frames as JSON and append a newline. The decoder holds incomplete data and extracts complete lines, while UTF-8 decoding preserves split characters. JSON escapes newlines inside a payload, so they do not become frame boundaries. Each message has a UUID, and each recipient must return the matching application ACK. We validate identifiers, reject empty or oversized payloads and keep bounded logs. The tests cover split frames, combined frames, invalid JSON, Unicode and concurrent messages.

## Slide 8 — Manan Shah

For the failure demonstration we stop the real central hub in client–server mode. A and B are still configured clients, but their routing service has gone, so all five A-to-B probes fail. In peer-to-peer mode, we stop peer D instead. A and B retain their direct connection, so all five surviving-pair probes succeed. D is still unreachable: P2P does not make an offline endpoint available. Restoring the failed component recovers delivery. These roles are different, so our conclusion is about dependency on a central service, not a universal reliability ranking.

## Slide 9 — Armaan Lad

Both architectures used four endpoints and the same 64-byte A-to-B payload. Each ran thirty sequential messages in each of three trials. We created fresh sockets, excluded three warm-up messages per trial and alternated which architecture ran first. Both received all ninety expected ACKs. The packaged run measured mean application RTTs of 0.117 milliseconds for the hub model and 0.062 milliseconds for direct peers. Those values include application processing and logging on one machine. The structural result is stable: the mesh uses more connections but a shorter forwarding path. The timings can change on another machine.

## Slide 10 — Armaan Lad

The packaged automated run passed forty-one tests with zero failures. It covers both TCP models, framing, Unicode, concurrent message identities, validation, failure and recovery. The HTTP and native server-sent event interfaces are tested too. We also ran thirty interface checks, including mobile layouts, navigation, inbox escaping and experiment history. The build browser restricted direct URL navigation, so the interface checks used a documented local HTTP bridge with unchanged production UI code. We distinguish that from direct-browser end-to-end testing rather than overstating the evidence.

## Slide 11 — Armaan Lad

The project demonstrates real socket communication and a specific architectural trade-off. It does not measure internet conditions, and all endpoints share one process. A process or host failure would stop the whole lab. P2P here means a full mesh, not every possible peer-to-peer design. We have no NAT traversal, authenticated peer identity, encryption or replicated hub. The next logical step is separate processes or containers, then controlled network conditions and security. These limitations matter when interpreting the lower RTT seen in this particular local run.

## Slide 12 — Armaan Lad

Our conclusion is not that one architecture always wins. A central relay makes connection management simple, but communication depends on that relay. Direct peers remove that forwarding dependency, but a full mesh creates more connections. NetScope makes those differences visible through real messages, acknowledgements, controlled faults and recorded results. We can now demonstrate the app by sending the same message in both modes, stopping a component and explaining the observed result. Thank you.

## Slide 13 — Any presenter (backup)

This is a backup runbook, not a required spoken slide. Open a terminal in the extracted NetScope_Project folder. Verify Node.js is available and run npm start. Open the displayed localhost address. Begin in the default hub mode, send a message and inspect the inbox. Stop the hub, show the failure, restore it, then switch to the peer mesh and stop D. Finish with the comparison and exported evidence. npm test reproduces the automated checks. The app needs no npm install or API key.

## Slide 14 — Any presenter (backup)

The Node TCP documentation supports the stream-based implementation, MDN documents the server-sent event control interface, and Node documents the built-in test runner. The original uploaded spreadsheets establish the topic and group details. The source ZIP includes the audit, actual measurement JSON, automated test log and documented UI checks. Topic availability is limited to the uploaded snapshot; the supplied selected workbook is a local copy, not an update to a live shared sheet.

