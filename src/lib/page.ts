import { readFile } from 'node:fs/promises';
import { escapeAttr, escapeHtml, render, type RenderContext } from './template.js';
import { propsFromQuery, type ScreenClass, type Values } from './screen.js';

export const WEB_ROOT = new URL('../../web/', import.meta.url);

const templates = new Map<string, string>();

async function loadTemplate(id: string): Promise<string> {
  let tpl = templates.get(id);
  if (tpl === undefined || process.env.NODE_ENV === 'development') {
    tpl = await readFile(new URL(`templates/${id}.html`, WEB_ROOT), 'utf8');
    templates.set(id, tpl);
  }
  return tpl;
}

/** Design link targets (`Foo.dc.html#x`) become app routes (`/Foo#x`). */
export function resolveHref(href: string): string {
  const m = /^([\w.-]+)\.dc\.html(#.*)?$/.exec(href);
  if (!m) return href;
  const route = m[1] === 'Main' ? '/' : `/${m[1]}`;
  return route + (m[2] ?? '');
}

export function routeFor(id: string): string {
  return id === 'Main' ? '/' : `/${id}`;
}

// Elements carrying data-action-href (rendered from onClick handlers) navigate to
// the URL of the state they produce; scroll position is kept across that reload.
const ACTION_SCRIPT = `<script>
(() => {
  const key = 'majayong:scroll:' + location.pathname;
  try { const y = sessionStorage.getItem(key); if (y) { sessionStorage.removeItem(key); scrollTo(0, +y); } } catch {}
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element && e.target.closest('[data-action-href]');
    if (!el) return;
    e.preventDefault();
    try { sessionStorage.setItem(key, String(scrollY)); } catch {}
    location.assign(el.getAttribute('data-action-href'));
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
    resolveHref,
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
