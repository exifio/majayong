/**
 * Renders every screen in every declared design state to `<outDir>/`.
 * Used to diff output before/after refactors: `node dist/snapshot.js <outDir>`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderScreen } from './lib/page.js';
import { screens } from './screens/index.js';

const outDir = process.argv[2] ?? 'snapshots';
await mkdir(outDir, { recursive: true });
let count = 0;
for (const Screen of screens) {
  const queries: [string, URLSearchParams][] = [['default', new URLSearchParams()]];
  for (const [name, spec] of Object.entries(Screen.props)) {
    const options = spec.editor === 'enum' ? (spec.options ?? []) : spec.editor === 'boolean' ? ['true', 'false'] : [];
    for (const o of options) queries.push([`${name}=${o}`, new URLSearchParams({ [name]: o })]);
  }
  for (const [label, q] of queries) {
    const html = await renderScreen(Screen, q);
    await writeFile(join(outDir, `${Screen.id}__${label.replace(/[^\p{L}\p{N}=_-]+/gu, '_')}.html`), html);
    count++;
  }
}
console.log(`${count} pages rendered to ${outDir}`);
