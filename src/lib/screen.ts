/**
 * A screen is one page of the product: a template in `web/templates/<id>.html`
 * plus a view model (`renderVals`) computed from its props and state.
 *
 * Props are the screen's design levers (which view or state to show); they
 * arrive from the query string, e.g. `/Account-Client?view=탈퇴 확인`.
 * State is per-visit UI state that handlers change via `setState`.
 */

export interface PropSpec {
  editor: string;
  options?: readonly string[];
  default?: unknown;
  section?: string;
  label?: string;
}

export type PropSpecs = Record<string, PropSpec>;

// View models are free-form bags of values read by template holes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Values = Record<string, any>;

export abstract class Screen {
  /** Template / route name, e.g. `Home-Client`. */
  static readonly id: string = '';
  static readonly title: string = '';
  /** Whether the page uses the shared design-system stylesheet. */
  static readonly sharedStyles: boolean = true;
  static readonly props: PropSpecs = {};

  readonly props: Values;
  state: Values;
  #onSetState: ((next: Values) => void) | null = null;

  constructor(props: Values = {}, state: Values = {}) {
    this.props = props;
    this.state = state;
  }

  setState(patch: Values): void {
    const next = { ...this.state, ...patch };
    if (this.#onSetState) this.#onSetState(next);
    else this.state = next;
  }

  /** Run a handler and report the state it would produce, without applying it. */
  captureState(handler: () => unknown): Values | null {
    let captured: Values | null = null;
    this.#onSetState = (next) => {
      captured = next;
    };
    try {
      handler();
    } finally {
      this.#onSetState = null;
    }
    return captured;
  }

  abstract renderVals(): Values;
}

export type ScreenClass = (new (props?: Values, state?: Values) => Screen) & {
  readonly id: string;
  readonly title: string;
  readonly sharedStyles: boolean;
  readonly props: PropSpecs;
};

/** Parse query-string props against a screen's declared prop specs. */
export function propsFromQuery(specs: PropSpecs, query: URLSearchParams): Values {
  const props: Values = {};
  for (const [name, spec] of Object.entries(specs)) {
    const raw = query.get(name);
    if (raw === null) {
      if (spec.default !== undefined) props[name] = spec.default;
      continue;
    }
    switch (spec.editor) {
      case 'boolean':
        props[name] = raw === 'true' || raw === '1';
        break;
      case 'number':
        props[name] = Number(raw);
        break;
      case 'enum':
        props[name] = spec.options?.includes(raw) ? raw : spec.default;
        break;
      default:
        props[name] = raw;
    }
  }
  return props;
}
