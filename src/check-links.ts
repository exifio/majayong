/**
 * Renders every screen in every design state and checks each internal link
 * (href and data-action-href):
 *   - the route exists;
 *   - every query key is a prop the target screen declares (or `_state`);
 *   - enum values are one of the declared options (an unknown value would
 *     silently fall back to the default state).
 * Also counts links that still go nowhere (`#…` without a matching id).
 *
 * Usage: node dist/check-links.js   (exit code 1 when a link is invalid)
 */
import { renderScreen, routeFor } from './lib/page.js';
import type { ScreenClass } from './lib/screen.js';
import { screens } from './screens/index.js';

const byRoute = new Map<string, ScreenClass>(screens.map((s) => [routeFor(s.id), s]));
const problems = new Set<string>();
let dead = 0;
let checked = 0;

function decode(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

for (const Screen of screens) {
  const states: URLSearchParams[] = [new URLSearchParams()];
  for (const [name, spec] of Object.entries(Screen.props)) {
    const options = spec.editor === 'enum' ? (spec.options ?? []) : spec.editor === 'boolean' ? ['true'] : [];
    for (const o of options) states.push(new URLSearchParams({ [name]: o }));
  }
  for (const q of states) {
    const html = await renderScreen(Screen, q);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    const where = `${routeFor(Screen.id)}${q.size ? `?${decodeURIComponent(q.toString())}` : ''}`;
    for (const m of html.matchAll(/\s(href|data-action-href)="([^"]*)"/g)) {
      const href = decode(m[2]!);
      if (href.startsWith('#')) {
        if (href === '#' || !ids.has(href.slice(1))) dead++;
        continue;
      }
      if (!href.startsWith('/') || href.startsWith('/assets/')) continue;
      checked++;
      const url = new URL(href, 'http://x');
      const target = byRoute.get(url.pathname);
      if (!target) {
        problems.add(`${where}: no screen at ${url.pathname}`);
        continue;
      }
      for (const [key, value] of url.searchParams) {
        if (key === '_state') continue;
        const spec = target.props[key];
        if (!spec) problems.add(`${where}: ${target.id} has no prop "${key}" (${href})`);
        else if (spec.editor === 'enum' && !spec.options?.includes(value))
          problems.add(`${where}: ${target.id} ${key}="${value}" is not one of ${spec.options?.join(' / ')}`);
        else if (spec.editor === 'boolean' && value !== 'true' && value !== 'false')
          problems.add(`${where}: ${target.id} ${key}="${value}" is not a boolean`);
      }
    }
  }
}

console.log(`${checked} internal links checked · ${dead} links still go nowhere (#…)`);
if (problems.size) {
  console.log(`\n${problems.size} invalid link(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
}
