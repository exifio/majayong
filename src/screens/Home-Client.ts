import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 홈 */
export default class HomeClientScreen extends Screen {
  static override readonly id = "Home-Client";
  static override readonly title = "의뢰인 — 홈";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "첫 방문"], "default": "기본", "section": "상태"}, "menuOpen": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const menuOpen = this.props.menuOpen ?? false;
    const first = (this.props.view ?? '기본') === '첫 방문';
    return { menuOpen: menuOpen, expanded: menuOpen ? 'true' : 'false', first: first, notFirst: !first,
      bellCls: first ? 'bell' : 'bell dot', chatLbl: first ? '채팅' : '채팅 — 새 메시지 1건', notiLbl: first ? '알림' : '알림 — 안 읽은 알림 3건' };
  }
}
