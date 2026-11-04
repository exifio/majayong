import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 홈 */
export default class HomeSupplierScreen extends Screen {
  static override readonly id = "Home-Supplier";
  static override readonly title = "공급자 — 홈";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "첫 방문"], "default": "기본", "section": "상태"}, "menuOpen": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const menuOpen = this.props.menuOpen ?? false;
    const first = (this.props.view ?? '기본') === '첫 방문';
    return { isFirst: first, isBase: !first, menuOpen: menuOpen, expanded: menuOpen ? 'true' : 'false', menuHref: menuOpen ? '?menuOpen=false' : '?menuOpen=true' };
  }
}
