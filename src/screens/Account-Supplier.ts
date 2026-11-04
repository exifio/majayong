import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 계정 설정 */
export default class AccountSupplierScreen extends Screen {
  static override readonly id = "Account-Supplier";
  static override readonly title = "공급자 — 계정 설정";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "탈퇴 확인", "비밀번호 변경 완료", "이메일 바꾸기", "계좌 바꾸기", "1원 보냄", "1원 인증 실패", "인증 완료", "계좌 변경 완료"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '기본';
    const done = v === '비밀번호 변경 완료';
    return { isLeave: v === '탈퇴 확인', isEmail: v === '이메일 바꾸기', isBank: ['계좌 바꾸기','1원 보냄','1원 인증 실패','인증 완료'].includes(v), bk0: v === '계좌 바꾸기', bkSent: v === '1원 보냄' || v === '1원 인증 실패', bkFail: v === '1원 인증 실패', bkOk: v === '인증 완료',
      bkInpCls: v === '1원 인증 실패' ? 'inp err' : 'inp', bkCode: v === '1원 인증 실패' ? '4831' : '', bkTime: v === '1원 인증 실패' ? '08:15' : '09:42',
      bkCan: v === '인증 완료', bkCant: v !== '인증 완료', bkWhy: v === '인증 완료' ? '처리 중인 지급은 지금 계좌로 갑니다.' : '1원 인증을 마치면 바꿀 수 있습니다',
      bkDone: v === '계좌 변경 완료', bankNow: v === '계좌 변경 완료' ? '국민은행 · 끝자리 7890 · 예금주 최준호' : '신한은행 · 끝자리 2048 · 예금주 최준호', isDone: done, pw0: done ? '' : '••••••••••', pw1: done ? '' : '••••••••••••' };
  }
}
