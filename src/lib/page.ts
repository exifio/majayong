import { readFile } from 'node:fs/promises';
import { escapeAttr, escapeHtml, render, type RenderContext } from './template.js';
import { propsFromQuery, type ScreenClass, type Values } from './screen.js';

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
export const WEB_ROOT = pathToFileURL(join(process.cwd(), 'web') + '/');

const templates = new Map<string, string>();

async function loadTemplate(id: string): Promise<string> {
  let tpl = templates.get(id);
  if (tpl === undefined || process.env.NODE_ENV === 'development') {
    tpl = await readFile(new URL(`templates/${id}.html`, WEB_ROOT), 'utf8');
    templates.set(id, tpl);
  }
  return tpl;
}

/**
 * Design link targets become app routes:
 *   `Foo.dc.html?view=x#y` → `/Foo?view=x#y`
 *   `?view=x`              → current screen, current props with `view` replaced
 *                            (UI state from setState is kept).
 */
export function resolveHref(href: string, current?: { id: string; query: URLSearchParams }): string {
  if (href.startsWith('?') && current) {
    const [qs = '', frag] = href.slice(1).split('#');
    const q = new URLSearchParams(current.query);
    for (const [k, v] of new URLSearchParams(qs)) q.set(k, v);
    const query = q.toString();
    return routeFor(current.id) + (query ? `?${query}` : '') + (frag !== undefined ? `#${frag}` : '');
  }
  const m = /^([\w.-]+)\.dc\.html(\?[^#]*)?(#.*)?$/.exec(href);
  if (!m) return href;
  const query = m[2] ? new URLSearchParams(m[2].slice(1)).toString() : '';
  return routeFor(m[1]!) + (query ? `?${query}` : '') + (m[3] ?? '');
}

export function routeFor(id: string): string {
  return id === 'Main' ? '/' : `/${id}`;
}

// Elements carrying data-print open the print dialog (계약서 내려받기 → PDF).
// Elements carrying data-action-href navigate to that URL. For onClick handlers it is
// the URL of the state they produce (`_state=`), and the scroll position is kept so an
// in-page change (a selected star, an expanded section) doesn't jump to the top.
// Other targets (opening a modal state, switching a tab) start at the top, where the
// designs place their dialogs.
const ACTION_SCRIPT = `<script src="/assets/api.js?v=20261105"></script>
<script src="/assets/flow.js?v=20261105"></script>
<script>
(() => {
  const key = 'majayong:scroll:' + location.pathname;
  try { const y = sessionStorage.getItem(key); if (y) { sessionStorage.removeItem(key); scrollTo(0, +y); } } catch {}
  document.addEventListener('click', (e) => {
    // data-print: save the page as PDF through the browser's print dialog.
    if (e.target instanceof Element && e.target.closest('[data-print]')) { e.preventDefault(); print(); return; }
    const el = e.target instanceof Element && e.target.closest('[data-action-href]');
    if (!el) return;
    e.preventDefault();
    const href = el.getAttribute('data-action-href');
    if (href.includes('_state=')) { try { sessionStorage.setItem(key, String(scrollY)); } catch {} }
    location.assign(href);
  });
})();
</script>`;

export async function renderScreen(Screen: ScreenClass, query: URLSearchParams): Promise<string> {
  const props = propsFromQuery(Screen.props, query);
  let state: Values = {};
  const rawState = query.get('_state');
  if (rawState) {
    try {
      const parsed: unknown = JSON.parse(rawState);
      if (parsed && typeof parsed === 'object') state = parsed as Values;
    } catch {
      /* ignore malformed state */
    }
  }

  const screen = new Screen(props, state);
  const values = screen.renderVals();

  const ctx: RenderContext = {
    resolveHref: (href) => resolveHref(href, { id: Screen.id, query }),
    actionHref(handler) {
      const next = screen.captureState(handler);
      if (!next) return null;
      const q = new URLSearchParams(query);
      q.set('_state', JSON.stringify(next));
      return `${routeFor(Screen.id)}?${q.toString()}`;
    },
  };

  const source = await loadTemplate(Screen.id);
  const [, helmet = '', body = source] = /^\s*<helmet>([\s\S]*?)<\/helmet>([\s\S]*)$/.exec(source) ?? [];
  const head = render(helmet, values, ctx).trim();
  const markup = render(body, values, ctx).trim();

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(Screen.title)} · 마자용</title>
<link rel="preload" href="/assets/fonts/PretendardVariable.woff2" as="font" type="font/woff2" crossorigin>
${Screen.sharedStyles ? '<link rel="stylesheet" href="/assets/app.css">\n' : ''}${head}
</head>
<body data-screen="${escapeAttr(Screen.id)}">
${markup}
${ACTION_SCRIPT}
</body>
</html>
`;
}
