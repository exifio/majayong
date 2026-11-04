import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 계정 설정 */
export default class AccountSupplierScreen extends Screen {
  static override readonly id = "Account-Supplier";
  static override readonly title = "공급자 — 계정 설정";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "탈퇴 확인", "비밀번호 변경 완료", "이메일 바꾸기", "계좌 바꾸기"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '기본';
    const done = v === '비밀번호 변경 완료';
    return { isLeave: v === '탈퇴 확인', isEmail: v === '이메일 바꾸기', isBank: v === '계좌 바꾸기', isDone: done, pw0: done ? '' : '••••••••••', pw1: done ? '' : '••••••••••••' };
  }
}
