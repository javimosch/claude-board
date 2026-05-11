import { appendFileSync } from 'fs';

export function log(msg: string) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${msg}`;
  console.log(logMsg);
  try {
    appendFileSync('server.log', logMsg + '\n');
  } catch (e) {
    // Ignore logging errors
  }
}
