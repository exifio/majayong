import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 계정 설정 */
export default class AccountClientScreen extends Screen {
  static override readonly id = "Account-Client";
  static override readonly title = "의뢰인 — 계정 설정";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "탈퇴 확인", "비밀번호 변경 완료", "이메일 바꾸기", "구글 연결 해제", "증빙 정보 바꾸기", "증빙 정보 오류", "증빙 정보 저장 완료"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '기본';
    const done = v === '비밀번호 변경 완료';
    const tx = v === '증빙 정보 바꾸기', txe = v === '증빙 정보 오류', txd = v === '증빙 정보 저장 완료';
    return { isTax: tx || txe, taxErr: txe, taxOk: !txe, taxNo: txe ? '418-81-2955' : '418-81-29544', taxInpCls: txe ? 'inp err' : 'inp', isTaxDone: txd,
      taxNow: txd ? '사업자등록번호 끝자리 9544 · 세금계산서 받을 이메일 tax.ondo@example.com' : '사업자등록번호 끝자리 4417 · 세금계산서 받을 이메일 tax.ondo@example.com',
      isEmail: v === '이메일 바꾸기', isGoogle: v === '구글 연결 해제', isLeave: v === '탈퇴 확인', isDone: done, pw0: done ? '' : '••••••••••', pw1: done ? '' : '••••••••••••' };
  }
}
