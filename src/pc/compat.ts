import * as crypto from 'crypto';
import * as dns from 'dns/promises';
import * as os from 'os';
import * as fs from 'fs';
const nodejs = typeof process != 'undefined' ? process : undefined;
export { nodejs as process };
export const homeDir = os.homedir();
export function md5(s: string) {
  return crypto.createHash('md5').update(s).digest('hex');
}
export async function sha512(s: string) {
  return crypto.createHash('sha512').update(s).digest('hex');
}
/** Convert bytes to a base64 string, using either nodejs or web API. */
export function base64(data: Uint8Array) {
  return Buffer.from(data).toString('base64');
}
/** Returns false if the user is not online. */
export async function isOnline(host: string) {
  try { return !!(await dns.lookup(host)).address; }
  catch (err) { return false; }
}
export const rmSync = nodejs ? fs.rmSync : undefined;
