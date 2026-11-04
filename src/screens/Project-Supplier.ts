import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 프로젝트 상세 */
export default class ProjectSupplierScreen extends Screen {
  static override readonly id = "Project-Supplier";
  static override readonly title = "공급자 — 프로젝트 상세";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["지원 전", "지원함", "재견적 요청", "모집 마감"], "default": "지원 전", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '지원 전';
    const before = v === '지원 전', applied = v === '지원함', re = v === '재견적 요청', closed = v === '모집 마감';
    const bm = !before; // 지원 전에는 아직 북마크 안 함
    type Fn = [string, string, string[], string];
    const F: Fn[] = [
      ['예약 달력', '회차별로 예약받고 정원이 차면 마감', ['회차 구성', '예약 가능 기간'], ''],
      ['예약금 결제', '예약할 때 예약금을 받고 환불 규정 안내', ['예약금 금액', '환불 기준'], '예약금은 1인 3만원 정도 생각 중'],
      ['노쇼 기록', '노쇼 손님을 기록해 다음 예약 때 표시', ['노쇼 판정 기준', '표시 방식'], ''],
      ['리마인드 알림', '예약 전날 손님에게 안내 자동 발송', ['발송 시점', '발송 수단'], '']
    ];
    const chg = ['', '', '', '', ''];
    if (re) {
      F[3] = ['리마인드 알림', '예약 전날과 당일 3시간 전 손님에게 안내 자동 발송', ['발송 시점', '발송 수단'], ''];
      F.push(['단골 표시', '세 번 이상 방문한 손님을 예약 목록에 표시', ['단골 기준'], '']);
      chg[3] = '설명 바뀜'; chg[4] = '새 항목';
    }
    const fns = F.map((f, i) => ({
      no: i + 1, name: f[0], desc: f[1], memo: f[3], hasMemo: !!f[3],
      changed: !!chg[i], chg: chg[i],
      decs: f[2].map((d) => ({ name: d, cls: chg[i] === '새 항목' ? 'new' : '' }))
    }));
    return {
      fns: fns, nFn: fns.length, isBefore: before, isApplied: applied, isRe: re, isClosed: closed,
      stChip: closed ? '모집 마감' : '모집 중', stChipCls: closed ? 'chip out' : 'chip blue',
      dl: closed ? '11월 3일 마감' : '마감 11월 3일 · 2일 남음', dlCls: closed ? '' : 'soon',
      subMore: re ? ' · 11월 2일 명세 수정' : '',
      bmCls: 'btn sm gh bmt' + (bm ? ' on' : ''), bmFill: bm ? 'currentColor' : 'none', bmPressed: bm ? 'true' : 'false',
      bmLabel: bm ? '북마크함' : '북마크'
    };
  }
}
