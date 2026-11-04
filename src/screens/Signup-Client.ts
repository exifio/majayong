import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 프로필 입력 */
export default class SignupClientScreen extends Screen {
  static override readonly id = "Signup-Client";
  static override readonly title = "의뢰인 프로필 입력";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"fromAction": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const fromAction = this.props.fromAction ?? false;
    return {
      fromAction: fromAction,
      inSignup: !fromAction,
      heading: fromAction ? '가게 정보를 입력해주세요' : '가게 정보를 알려주세요',
      subline: fromAction
        ? '저장하면 작성하시던 명세 확정 화면으로 돌아갑니다. 여기 적으신 내용은 그대로 프로필이 되고, 나중에 고치실 수 있습니다.'
        : '여기 적으신 내용이 그대로 프로필이 됩니다. 지금 비워두셔도 되고, 나중에 ‘내 프로필’에서 언제든 고치실 수 있습니다.',
      backHref: fromAction ? 'Confirm-Client.dc.html' : 'Signup-Role.dc.html',
      saveHref: fromAction ? 'Confirm-Client.dc.html' : 'Home-Client.dc.html',
      backLabel: fromAction ? '돌아가기' : '이전',
      saveLabel: fromAction ? '저장하고 명세 확정으로 돌아가기' : '저장하고 시작하기'
    };
  }
}
