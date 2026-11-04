import { escapeAttr, escapeHtml } from './template.js';
import { routeFor } from './page.js';
import type { ScreenClass } from './screen.js';

const GROUPS: { label: string; match: (title: string) => boolean }[] = [
  { label: '비로그인 · 공통', match: (t) => /^(비로그인|공통)/.test(t) },
  { label: '회원가입', match: (t) => t.startsWith('회원가입') },
  { label: '의뢰인', match: (t) => t.startsWith('의뢰인') },
  { label: '공급자', match: (t) => t.startsWith('공급자') },
  { label: '운영자', match: (t) => t.startsWith('운영자') },
];

function variants(Screen: ScreenClass): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  for (const [name, spec] of Object.entries(Screen.props)) {
    const options =
      spec.editor === 'enum' ? (spec.options ?? []) : spec.editor === 'boolean' ? ['true'] : [];
    for (const option of options) {
      if (option === spec.default || (spec.editor === 'boolean' && spec.default === true)) continue;
      const q = new URLSearchParams({ [name]: option });
      out.push({ label: spec.editor === 'boolean' ? `${name}` : option, href: `${routeFor(Screen.id)}?${q}` });
    }
  }
  return out;
}

/** `/screens`: every screen and its design states, for review. */
export function renderCatalog(screens: readonly ScreenClass[]): string {
  const sections = GROUPS.map((group) => {
    const items = screens.filter((s) => group.match(s.title));
    if (!items.length) return '';
    const rows = items
      .map((s) => {
        const vs = variants(s)
          .map((v) => `<a class="tag" href="${escapeAttr(v.href)}">${escapeHtml(v.label)}</a>`)
          .join('');
        return `<li class="cat-row">
  <a class="cat-name" href="${escapeAttr(routeFor(s.id))}">${escapeHtml(s.title)}</a>
  <code>${escapeHtml(routeFor(s.id))}</code>
  ${vs ? `<div class="tagrow">${vs}</div>` : ''}
</li>`;
      })
      .join('\n');
    return `<section class="card"><h2 class="ct">${escapeHtml(group.label)} <span class="dim">${items.length}</span></h2><ul class="cat">${rows}</ul></section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>화면 목록 · 마자용</title>
<link rel="stylesheet" href="/assets/app.css">
<style>
.pg{word-break:keep-all}
.cat{list-style:none;margin:0;padding:0}
.cat-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;padding:12px 0;border-top:1px solid var(--s200)}
.cat-row:first-child{border-top:0}
.cat-name{font-weight:600;color:var(--s900);text-decoration:none}
.cat-name:hover{color:var(--blue-600)}
.cat-row code{font-size:13px;color:var(--s600)}
.cat-row .tagrow{flex-basis:100%;margin:0}
.cat-row .tag{text-decoration:none}
.card{margin-bottom:20px}
</style>
</head>
<body>
<div class="pg">
  <header class="gnb"><div class="wrap"><div class="gnbin">
    <a class="brand" href="/"><span class="mark" aria-hidden="true"><i style="height:9px"></i><i style="height:17px"></i><i style="height:12px;opacity:.55"></i></span>마자용</a>
  </div></div></header>
  <main class="pad"><div class="narrow">
    <h1 class="t">화면 목록</h1>
    <p class="sub">화면 ${screens.length}종 · 태그를 누르면 그 화면의 다른 상태를 봅니다.</p>
    ${sections}
  </div></main>
</div>
</body>
</html>
`;
}
