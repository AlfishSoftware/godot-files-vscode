// Cross-platform utility code, implementation on PC/NodeJS platform
import * as crypto from 'crypto';
import * as dns from 'dns/promises';

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
