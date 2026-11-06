// Separate rehearsal room. Uses the saved source observations, never reads or
// writes the real performance save and never changes the running server.
import { createPerformanceServer } from '../app/server.mjs';
const port = Number(process.env.STUDY_PORT || 4185);
const instance = await createPerformanceServer({ port, lanEnabled: true, persistencePath: null });
await instance.room.bootstrap({ state: null });
await instance.listen();
console.log(JSON.stringify({ ready: true, pid: process.pid, port, operator: `http://127.0.0.1:${port}/operator`, projection: `http://127.0.0.1:${port}/projection`, study: `http://127.0.0.1:${port}/study`, rehearsalOnly: true, persistence: false }));
const close = async () => { await instance.close(); process.exit(0); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
