import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 프로필 입력 */
export default class SignupSupplierScreen extends Screen {
  static override readonly id = "Signup-Supplier";
  static override readonly title = "공급자 프로필 입력";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"fromAction": {"editor": "boolean", "default": false, "section": "상태"}};


  renderVals(): Values {
    const fromAction = this.props.fromAction ?? false;
    return {
      fromAction: fromAction,
      inSignup: !fromAction,
      heading: fromAction ? '프로필을 입력해주세요' : '어떤 일을 하시는지 알려주세요',
      subline: fromAction
        ? '저장하면 작성하시던 견적 화면으로 돌아갑니다. 여기 적으신 내용은 그대로 프로필이 되고, 나중에 고치실 수 있습니다.'
        : '여기 적으신 내용이 그대로 프로필이 됩니다. 지금 비워두셔도 되고, 나중에 ‘내 프로필’에서 고치실 수 있습니다.',
      backHref: fromAction ? 'Project-Supplier.dc.html' : 'Signup-Role.dc.html',
      backLabel: fromAction ? '돌아가기' : '이전',
      nextHref: fromAction ? 'QuoteWrite-Supplier.dc.html' : 'Home-Supplier.dc.html',
      saveLabel: fromAction ? '저장하고 견적으로 돌아가기' : '저장하고 가입 완료'
    };
  }
}
