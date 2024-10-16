#!/usr/bin/node
// Download tools needed for development if necessary.

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);

export const dirPath = dirname(__filename);
export const dependencies = JSON.parse(readFileSync(`${dirPath}/dependencies.json`, 'utf-8'));

/** @param {string} relativePath */
export async function fetchDependency(relativePath) {
  const absolutePath = dirPath + '/' + relativePath;
  if (!existsSync(absolutePath)) {
    const url = dependencies[relativePath];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch "${url}" with status ${res.status} (${res.statusText}).`);
    writeFileSync(absolutePath, new Uint8Array(await res.arrayBuffer()));
    console.log(`Downloaded "${relativePath}" from "${url}".`);
  }
  return absolutePath;
}

/**
 * @param {string | URL} cwd
 * @param {string} jarPath
 * @param {string[]} args
 */
export async function executeJar(cwd, jarPath, args) {
  return await execFileAsync('java', ['-jar', jarPath, ...args], { encoding: 'utf-8', cwd });
}
