/**
 * Server-side renderer for the screen template syntax.
 *
 * Templates are plain HTML plus:
 *   {{ path }}                         dotted lookup into the screen's values
 *   <sc-if value="{{ cond }}">…</sc-if>  conditional block (no wrapper element)
 *   <sc-for list="{{ xs }}" as="x">…</sc-for>  repeat, with {{ x.* }} and {{ $index }}
 *   onClick="{{ handler }}"            a handler that calls screen.setState()
 *
 * Holes support literals (true/false/null/numbers/'strings'), `!x`,
 * and `a === b` / `a !== b` comparisons. Text holes render escaped;
 * null/boolean/undefined render nothing.
 */

export type Scope = Record<string, unknown>;

export interface RenderContext {
  /**
   * Map a link target to a URL: `Home-Client.dc.html?view=x#y` (another screen)
   * or `?view=x` (another state of the current screen).
   */
  resolveHref(href: string): string;
  /** Turn an event handler into a URL that, when visited, shows the resulting state. */
  actionHref(handler: (...args: unknown[]) => unknown): string | null;
}

type Node =
  | { kind: 'raw'; text: string }
  | { kind: 'tag'; source: string }
  | { kind: 'if'; value: string; children: Node[] }
  | { kind: 'for'; list: string; as: string; children: Node[] };

const TOKEN_RE =
  /<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:-]*(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const HOLE_RE = /\{\{([\s\S]+?)\}\}/g;
const WHOLE_HOLE_RE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

const cache = new Map<string, Node[]>();

export function parse(source: string): Node[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const root: Node[] = [];
  const stack: { node: Node & { children: Node[] }; tag: string }[] = [];
  const out = () => (stack.length ? stack[stack.length - 1]!.node.children : root);
  let last = 0;
  for (const m of source.matchAll(TOKEN_RE)) {
    const at = m.index;
    if (at > last) out().push({ kind: 'raw', text: source.slice(last, at) });
    last = at + m[0].length;
    const tok = m[0];
    if (tok.startsWith('<!--')) continue;
    const name = /^<\/?([\w:-]+)/.exec(tok)![1]!.toLowerCase();
    if (name === 'sc-if' || name === 'sc-for') {
      if (tok.startsWith('</')) {
        const top = stack.pop();
        if (!top || top.tag !== name) throw new Error(`Unbalanced </${name}>`);
        continue;
      }
      const attrs = parseAttrs(tok);
      const node: Node & { children: Node[] } =
        name === 'sc-if'
          ? { kind: 'if', value: attrs.get('value') ?? '', children: [] }
          : { kind: 'for', list: attrs.get('list') ?? '', as: attrs.get('as') ?? 'item', children: [] };
      out().push(node);
      stack.push({ node, tag: name });
      continue;
    }
    out().push({ kind: 'tag', source: tok });
  }
  if (last < source.length) out().push({ kind: 'raw', text: source.slice(last) });
  if (stack.length) throw new Error(`Unclosed <${stack[stack.length - 1]!.tag}>`);
  cache.set(source, root);
  return root;
}

function parseAttrs(tag: string): Map<string, string> {
  const body = tag.replace(/^<\/?[\w:-]+/, '').replace(/\/?>$/, '');
  const attrs = new Map<string, string>();
  for (const m of body.matchAll(ATTR_RE)) attrs.set(m[1]!, m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

// Elements whose content is plain text: an interpolated value inside them must not be
// wrapped in a <span> (it would show up as literal "<span>" text).
const RAW_TEXT = new Set(['textarea', 'title', 'option']);

interface Walk {
  ctx: RenderContext;
  /** Name of the raw-text element we are inside, if any. */
  rawText: string | null;
}

export function render(source: string, values: Scope, ctx: RenderContext): string {
  return renderNodes(parse(source), [values], { ctx, rawText: null });
}

function renderNodes(nodes: Node[], scopes: Scope[], walk: Walk): string {
  const { ctx } = walk;
  let html = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'raw':
        html += renderText(node.text, scopes, walk.rawText !== null);
        break;
      case 'tag':
        trackRawText(node.source, walk);
        html += renderTag(node.source, scopes, ctx);
        break;
      case 'if':
        if (evalAttr(node.value, scopes)) html += renderNodes(node.children, scopes, walk);
        break;
      case 'for': {
        const list = evalAttr(node.list, scopes);
        if (!Array.isArray(list)) break;
        list.forEach((item, index) => {
          html += renderNodes(node.children, [...scopes, { [node.as]: item, $index: index }], walk);
        });
        break;
      }
    }
  }
  return html;
}

function trackRawText(tag: string, walk: Walk): void {
  const m = /^<(\/?)([\w:-]+)/.exec(tag);
  if (!m) return;
  const name = m[2]!.toLowerCase();
  if (!RAW_TEXT.has(name)) return;
  if (m[1]) {
    if (walk.rawText === name) walk.rawText = null;
  } else if (!tag.endsWith('/>')) walk.rawText = name;
}

function renderText(text: string, scopes: Scope[], plain = false): string {
  if (!text.includes('{{')) return text;
  return text.replace(HOLE_RE, (_, expr: string) => {
    const v = evaluate(expr, scopes);
    if (v === undefined || v === null || typeof v === 'boolean') return '';
    // The design runtime wraps every interpolated value in a span; keep that so
    // descendant selectors in the page styles match exactly as designed.
    return plain ? escapeHtml(String(v)) : `<span>${escapeHtml(String(v))}</span>`;
  });
}

function renderTag(source: string, scopes: Scope[], ctx: RenderContext): string {
  if (source.startsWith('</') || !/\{\{|\.dc\.html|href="\?/.test(source)) return source;
  const name = /^<([\w:-]+)/.exec(source)![1]!;
  const selfClosing = /\/>$/.test(source);
  let out = `<${name}`;
  for (const [attr, raw] of parseAttrs(source)) {
    // `<input {{chk}}>`: a hole in attribute-name position yields a bare attribute.
    const nameHole = WHOLE_HOLE_RE.exec(attr);
    if (nameHole) {
      const v = evaluate(nameHole[1]!, scopes);
      if (typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v)) out += ` ${v}`;
      continue;
    }
    const whole = WHOLE_HOLE_RE.exec(raw);
    if (/^on[A-Z]/.test(attr)) {
      const handler = whole ? evaluate(whole[1]!, scopes) : undefined;
      const href = typeof handler === 'function' ? ctx.actionHref(handler as () => unknown) : null;
      if (href) out += ` data-action-href="${escapeAttr(href)}"`;
      continue;
    }
    // `raw` is source text (already entity-encoded); only hole values need escaping.
    let encoded: string;
    if (whole) {
      let value = evaluate(whole[1]!, scopes);
      if (typeof value === 'function') continue;
      if (typeof value === 'boolean' || value === null || value === undefined) {
        if (attr.startsWith('aria-')) value = String(value === true);
        else if (value === true) {
          out += ` ${attr}`;
          continue;
        } else continue;
      }
      encoded = escapeAttr(String(value));
    } else {
      encoded = raw.replace(HOLE_RE, (_, expr: string) => {
        const v = evaluate(expr, scopes);
        return v === undefined || v === null ? '' : escapeAttr(String(v));
      });
    }
    if (attr === 'href' || attr === 'data-action-href') encoded = escapeAttr(ctx.resolveHref(decodeEntities(encoded)));
    out += raw === '' && !whole ? ` ${attr}` : ` ${attr}="${encoded.replace(/"/g, '&quot;')}"`;
  }
  return out + (selfClosing ? ' />' : '>');
}

function interpolate(raw: string, scopes: Scope[]): string {
  return raw.replace(HOLE_RE, (_, expr: string) => {
    const v = evaluate(expr, scopes);
    return v === undefined || v === null ? '' : String(v);
  });
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function evalAttr(raw: string, scopes: Scope[]): unknown {
  const whole = WHOLE_HOLE_RE.exec(raw);
  return whole ? evaluate(whole[1]!, scopes) : interpolate(raw, scopes);
}

export function evaluate(expression: string, scopes: Scope[]): unknown {
  const e = expression.trim();
  if (!e) return undefined;
  if (e.startsWith('(') && e.endsWith(')')) return evaluate(e.slice(1, -1), scopes);
  const cmp = /^(.+?)\s*(===|!==|==|!=)\s*(.+)$/.exec(e);
  if (cmp) {
    const a = evaluate(cmp[1]!, scopes);
    const b = evaluate(cmp[3]!, scopes);
    switch (cmp[2]) {
      case '===':
        return a === b;
      case '!==':
        return a !== b;
      case '==':
        return a == b;
      default:
        return a != b;
    }
  }
  if (e.startsWith('!')) return !evaluate(e.slice(1), scopes);
  if (e === 'true') return true;
  if (e === 'false') return false;
  if (e === 'null') return null;
  if (e === 'undefined') return undefined;
  if (NUMBER_RE.test(e)) return Number(e);
  if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) return e.slice(1, -1);
  const [head, ...rest] = e.split('.');
  let v: unknown;
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(scopes[i], head!)) {
      v = scopes[i]![head!];
      break;
    }
  }
  for (const key of rest) {
    if (v === null || v === undefined) return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
