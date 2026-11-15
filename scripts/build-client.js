import { readFile, writeFile } from 'node:fs/promises';

const sourceUrl = new URL('../drag-events.js', import.meta.url);
const clientUrl = new URL('../client.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');
const client = await readFile(clientUrl, 'utf8');
const start = '    // BEGIN generated drag-events.js\n';
const end = '    // END generated drag-events.js';
const from = client.indexOf(start);
const to = client.indexOf(end);
if (from < 0 || to < from || client.indexOf(start, from + 1) !== -1) {
  throw new Error('Missing or duplicate drag-events.js generation markers');
}
const embedded = source.replace(/^export /gm, '').trimEnd().split('\n')
  .map((line) => line ? `    ${line}` : '').join('\n');
const updated = client.slice(0, from) + start + embedded + '\n' + client.slice(to);
if (process.argv.includes('--check')) {
  if (updated !== client) throw new Error('client.js is stale; run npm run build');
} else if (updated !== client) {
  await writeFile(clientUrl, updated);
}
