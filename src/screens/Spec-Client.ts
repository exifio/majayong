import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 명세 보기 */
export default class SpecClientScreen extends Screen {
  static override readonly id = "Spec-Client";
  static override readonly title = "의뢰인 — 명세 보기";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "명세 고치기 확인", "마감 연장", "임시 계약 중", "모집 시작됨"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '기본';
    const held = v === '임시 계약 중';
    const started = v === '모집 시작됨';
    const F = [
      ['예약 달력', '회차별로 예약받고 정원이 차면 마감', ['회차 구성', '예약 가능 기간'], ''],
      ['예약금 결제', '예약할 때 예약금을 받고 환불 규정 안내', ['예약금 금액', '환불 기준'], '전날 취소면 돌려주고 싶음'],
      ['노쇼 기록', '노쇼 손님을 기록해 다음 예약 때 표시', ['노쇼 판정 기준', '표시 방식'], ''],
      ['리마인드 알림', '예약 전날 손님에게 안내 자동 발송', ['발송 시점', '발송 수단'], '']
    ];
    return {
      fns: F.map((f, i) => ({ no: i + 1, name: f[0], desc: f[1], decs: f[2], memo: f[3], hasMemo: !!f[3] })),
      chip: held ? '임시 계약 중 · 서명 대기' : '모집 중', chipCls: held ? 'chip amber' : 'chip blue',
      canEdit: !held, held: held, started: started,
      views: started ? '0명' : '5명', apps: started ? '0건' : '3건',
      mEdit: v === '명세 고치기 확인', mExt: v === '마감 연장'
    };
  }
}
