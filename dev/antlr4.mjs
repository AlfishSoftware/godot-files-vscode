#!/usr/bin/node
// Compile grammars using antlr4.

import { fetchDependency, executeJar, dirPath } from './dependencies.mjs';

const jarPath = await fetchDependency('antlr4.jar');
/**
 * @param {string} grammarDir
 * @param {string[]} grammarFiles
 */
async function compileGrammar(grammarDir, ...grammarFiles) {
  const cwd = `${dirPath}/../src/${grammarDir}/`;
  try {
    const { stdout, stderr } = await executeJar(cwd, jarPath, [
      '-D' + 'language=TypeScript',
      '-W' + 'error',
      '-o', '.antlr/',
      ...grammarFiles,
    ]);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log(`Compiled "${grammarDir}" grammar.`);
  } catch (e) {
    if (e?.stderr == null) throw e;
    const { stdout, code } = e;
    if (stdout) console.log(stdout);
    console.error(e?.message ?? e);
    process.exitCode = code || 1;
  }
}
