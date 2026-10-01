# Viva preparation — NetScope

**Team:** Dhruv Paleja I081 · Manan Shah I053 · Armaan Lad I076  
**Official topic:** Simulate Peer-to-Peer vs Client-Server Architecture

## Opening explanation (Hinglish)

“Hamare project ka naam NetScope hai. Isme hum ek hi message ko do architectures mein send karke difference show karte hain. Client–server mein message central hub ke through jaata hai. Peer-to-peer mein nodes directly communicate karte hain. Diagram ke peeche actual TCP sockets chal rahe hain. Hum messages, acknowledgements, socket ports, failure aur recovery observe kar sakte hain.”

## Core questions

**1. What is the main objective?**  
To compare how the communication path, connection count and failure dependency change between a central message relay and a full peer mesh.

**2. Is this only an animation?**  
No. Actual Node TCP sockets carry DATA and application ACK frames on localhost. The diagram visualizes backend socket events. Animation timing is deliberately slowed; measured RTT comes from the backend clock.

**3. Why is Node.js suitable?**  
Its built-in `node:net` module supplies asynchronous TCP servers and clients. The project uses built-in HTTP, events, timers and tests, so there are no npm runtime dependencies.

**4. How does client–server delivery work?**  
A writes DATA to HUB; HUB forwards it to B. B sends its application ACK to HUB, which forwards it to A. Thus one acknowledged unicast has four application socket writes.

**5. How does P2P delivery work?**  
A sends directly to B on their bidirectional TCP connection. B sends an ACK directly back to A. No central data hub forwards that message.

**6. What is the connection formula?**  
For N clients, the star needs N links. A full peer mesh needs N(N−1)/2 links because each unordered pair needs one connection. At N=4, these are 4 and 6; at N=8, 8 and 28.

**7. Why divide the mesh formula by two?**  
Counting N−1 connections at each of N nodes counts A–B and B–A separately. A single bidirectional TCP connection represents both directions, so each pair was counted twice.

**8. Why does the dashboard remain visible after the server fails?**  
We stop the central TCP data hub, not the HTTP control server. The browser dashboard is a separate control interface inside the same process.

**9. Is the P2P system completely decentralized?**  
Message forwarding is peer-to-peer. Creation and observation of endpoints are centrally orchestrated, and all endpoints share one process. We do not claim full deployment decentralization or host-level fault isolation.

**10. What exactly is localhost?**  
The loopback address refers to the same machine. The logical endpoints are distinct sockets and ports, but they are not separate physical computers.

**11. Why do you use an application ACK if TCP already has ACKs?**  
A TCP ACK concerns transport delivery of bytes. Our application ACK confirms that the receiving application decoded the message and responded. They are different protocol layers and success criteria.

**12. How do you match an ACK to a message?**  
Each DATA message gets a UUID. The receiver echoes it in its ACK. The sender checks both the UUID and the recipient identity in its pending-message map.

**13. Why newline-delimited JSON?**  
TCP supplies a continuous stream, not preserved message boundaries. JSON serializes fields and escapes payload newlines. A separate newline terminates each complete frame for our decoder.

**14. What happens when TCP splits or combines reads?**  
Incomplete text remains in a buffer. Every complete newline-delimited frame is parsed independently, so both fragmentation and multiple frames per chunk work.

**15. What happens when a node goes offline during a broadcast?**  
The configured offline recipient is recorded as failed, while the reachable recipients can acknowledge. The result is partial delivery; the denominator is not silently reduced.

**16. How is success rate calculated?**  
Acknowledged intended recipients divided by all intended recipients, multiplied by 100. A four-node broadcast expects three recipients, excluding the sender.

**17. What is your RTT definition?**  
Elapsed monotonic time from initiating the send until the recipient's application ACK returns. It includes socket transfer, serialization, scheduling, logging and any configured teaching delay.

**18. Why are the measured times very small?**  
The endpoints run on one machine using loopback, not across a LAN or the internet. The report's values describe only this local experiment.

**19. Does P2P always have lower latency?**  
No. This implementation has a shorter application forwarding path, and the packaged local run measured lower mean RTT for its mesh. Other topologies, geographic distances, discovery, security and load can change the result.

**20. What is teaching delay?**  
An explicit timer before each DATA/ACK write. With d milliseconds per hop, a unicast introduces roughly 4d in the hub model and 2d in the direct model. It is not a change to the physical network. UI comparisons use zero delay.

**21. What failure result did you observe?**  
Removing HUB caused 0/5 A-to-B probes to succeed. Removing peer D left A and B connected, so 5/5 survived. Delivery to the unavailable endpoint failed in both cases, and recovery probes succeeded.

**22. Is this a fair comparison of component failures?**  
The removed components have different roles. This is an architectural-dependency demonstration, not a controlled reliability estimate for equally important production components.

**23. What tests were performed?**  
The packaged Node suite records 41 passing tests covering framing, real TCP modes, unicast/broadcast, invalid inputs, Unicode, concurrent sends, faults, recovery, HTTP and native SSE. Thirty UI checks also passed using a documented local HTTP bridge in the restricted build browser.

**24. Why are the test figures and live figures not identical?**  
Timers, scheduling, CPU load and logging introduce run-to-run variation. Structural counts and qualitative failure behavior should agree, but latency is a measured variable.

**25. What does the 95th percentile show?**  
Sort successful recipient RTTs and select the nearest-rank value at the 95% position. About 95% of that run's successful observations are at or below that value. It is not a worst-case bound.

**26. Are connection counts the same as packet counts?**  
No. One persistent TCP connection carries many messages. A JSON DATA write is also not guaranteed to be exactly one TCP segment or physical packet.

**27. Is the exported byte count network bandwidth?**  
No. It counts serialized DATA/ACK application bytes written across logical hops, excluding TCP/IP headers and registration. The sequential completion rate is also not link bandwidth.

**28. What happens when an ACK times out?**  
The pending target is marked as failed or unconfirmed. An application timeout alone does not prove that the receiver never received the DATA; its ACK might be missing. Our known offline failures are detected explicitly.

**29. What are the main limitations?**  
Same host and process, no realistic internet conditions, a full-mesh-only P2P model, no peer discovery, NAT traversal, TLS, authenticated identities, replicated hub or production deployment.

**30. What would you add next?**  
Run endpoints as separate processes or containers, then add controlled network conditions, TLS and peer identity, realistic discovery, hub replication, resource measurements and automated direct-browser end-to-end testing.

## Suggested speaking division

Dhruv: problem, objectives, overall architecture and UI.  
Manan: TCP flows, framing, ACK logic and failure demonstration.  
Armaan: measurement methodology, results, tests, limitations and conclusion.

This is a presentation split, not a claim about historical individual coding contributions. Everyone should understand the end-to-end flow and be able to run `npm start` and `npm test`.
