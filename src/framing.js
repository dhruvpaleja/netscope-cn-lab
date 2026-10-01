/**
 * TCP is a byte stream, not a message protocol. NDJSON supplies application
 * framing. setEncoding preserves UTF-8 characters split across TCP reads.
 */
export const MAX_FRAME_BYTES = 65536;

export function createLineDecoder(onFrame, onError = () => {}) {
  let buffer = '';
  let stopped = false;
  return chunk => {
    if (stopped) return;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
        stopped = true; onError(new Error('Frame exceeds 64 KiB')); return;
      }
      try {
        const frame = JSON.parse(line);
        if (!frame || Array.isArray(frame) || typeof frame !== 'object') {
          throw new Error('Frame must be a JSON object');
        }
        onFrame(frame);
      } catch (error) {
        stopped = true; onError(error); return;
      }
    }
    if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) {
      stopped = true; onError(new Error('Unterminated frame exceeds 64 KiB'));
    }
  };
}

export function attachFraming(socket, onFrame, onError = () => {}) {
  socket.setEncoding('utf8');
  socket.setNoDelay(true);
  socket.on('data', createLineDecoder(onFrame, error => {
    onError(error); socket.destroy();
  }));
  socket.on('error', onError);
}

export function encodeFrame(frame) {
  return JSON.stringify(frame) + '\n';
}
