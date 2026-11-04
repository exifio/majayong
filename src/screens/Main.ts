import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 비로그인 — 의뢰인 랜딩 */
export default class MainScreen extends Screen {
  static override readonly id = "Main";
  static override readonly title = "비로그인 — 의뢰인 랜딩";
  static override readonly sharedStyles = false;
  static override readonly props: PropSpecs = {"hero": {"editor": "enum", "options": ["자동 재생", "1 한 문장", "2 화면 초안", "3 고친 결과"], "default": "자동 재생", "section": "첫 화면"}};


  renderVals(): Values {
    const h = this.props.hero ?? '자동 재생';
    const n = h === '자동 재생' ? 0 : Number(h[0]);
    const st = n ? ' static st' + n : '';
    return { stageCls: 'stage' + st, stepsCls: 'steps' + st };
  }
}
