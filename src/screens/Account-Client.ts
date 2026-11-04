import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 계정 설정 */
export default class AccountClientScreen extends Screen {
  static override readonly id = "Account-Client";
  static override readonly title = "의뢰인 — 계정 설정";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "탈퇴 확인", "비밀번호 변경 완료", "이메일 바꾸기", "구글 연결 해제"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '기본';
    const done = v === '비밀번호 변경 완료';
    return { isEmail: v === '이메일 바꾸기', isGoogle: v === '구글 연결 해제', isLeave: v === '탈퇴 확인', isDone: done, pw0: done ? '' : '••••••••••', pw1: done ? '' : '••••••••••••' };
  }
}
