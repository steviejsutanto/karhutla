import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';

const base = process.env.MEASURE_URL || 'ws://127.0.0.1:4173';
const duration = Number(process.env.MEASURE_MS || 5000);
const results = await Promise.all(['operator', 'participant'].map(role => new Promise((resolve, reject) => {
  const socket = new WebSocket(`${base}/ws?role=${role}&clientId=measure-${role}-${Date.now()}`);
  const messages = [];
  socket.on('error', reject);
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    messages.push({ at: performance.now(), bytes: raw.length, type: message.type, cells: message.simulation?.cells?.length, delta: message.simulation?.delta });
  });
  socket.on('open', () => setTimeout(() => {
    socket.close();
    const updates = messages.filter(message => ['state', 'summary'].includes(message.type));
    const steady = updates.slice(1);
    resolve({ role, durationMs: duration, initialBytes: updates[0]?.bytes, initialCells: updates[0]?.cells,
      steadyMessages: steady.length, steadyBytes: steady.reduce((sum, message) => sum + message.bytes, 0),
      bytesPerSecond: Math.round(steady.reduce((sum, message) => sum + message.bytes, 0) / (duration / 1000)),
      averageChangedCells: steady.reduce((sum, message) => sum + (message.cells || 0), 0) / (steady.length || 1),
      messageTypes: [...new Set(messages.map(message => message.type))] });
  }, duration));
})));
const report = { measuredAt: new Date().toISOString(), results };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
