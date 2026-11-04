import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 회원가입 — 역할 선택 */
export default class SignupRoleScreen extends Screen {
  static override readonly id = "Signup-Role";
  static override readonly title = "회원가입 — 역할 선택";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["의뢰인 선택", "공급자 선택", "구글 가입"], "default": "의뢰인 선택", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '의뢰인 선택';
    const g = v === '구글 가입', sup = v !== '의뢰인 선택';
    return {
      google: g, isSup: sup,
      cliCls: sup ? '' : 'on', supCls: sup ? 'on' : '', cliChk: sup ? '' : 'checked', supChk: sup ? 'checked' : '',
      acctMsg: g ? '구글 계정으로 시작합니다 — junho@example.com' : (sup ? '계정이 만들어졌습니다 — junho@example.com' : '계정이 만들어졌습니다 — minjae.ondo@example.com'),
      backHref: g ? 'Login.dc.html' : 'Signup.dc.html',
      nextHref: sup ? 'Signup-Supplier.dc.html' : 'Signup-Client.dc.html'
    };
  }
}
