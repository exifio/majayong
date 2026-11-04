import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 로그인 모달 */
export default class LoginScreen extends Screen {
  static override readonly id = "Login";
  static override readonly title = "로그인 모달";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["의뢰인 랜딩에서", "공급자 랜딩에서", "로그인 실패", "역할 안내"], "default": "의뢰인 랜딩에서", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '의뢰인 랜딩에서';
    const sup = v === '공급자 랜딩에서' || v === '역할 안내';
    const fail = v === '로그인 실패', role = v === '역할 안내';
    return {
      cliBack: !sup, supBack: sup, isFail: fail, roleNotice: role, showForm: !role,
      goHref: sup ? 'Home-Supplier.dc.html' : 'Home-Client.dc.html',
      email: sup ? 'junho@example.com' : 'minjae.ondo@example.com',
      pw: fail ? '' : 'password1234', pwCls: fail ? 'inp warnline' : 'inp',
      heading: role ? '의뢰인 계정으로 로그인했습니다' : (sup ? '공급자 로그인' : '다시 오셨네요'),
      subline: role ? '가입하신 역할의 공간으로 들어갑니다.'
        : (sup ? '로그인하면 바로 모집 중인 프로젝트를 볼 수 있습니다.' : '작업 중이던 초안은 그대로 남아 있습니다.')
    };
  }
}
