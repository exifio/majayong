import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 단가 분석 리포트 */
export default class ReportClientScreen extends Screen {
  static override readonly id = "Report-Client";
  static override readonly title = "의뢰인 — 단가 분석 리포트";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"state": {"editor": "enum", "options": ["예산 안", "예산 초과", "만드는 중 포함"], "default": "예산 안", "section": "상태"}};


  renderVals(): Values {
    const st = this.props.state ?? '예산 안';
    const over = st === '예산 초과';
    const making = st === '만드는 중 포함';
    const won = (n: number) => n.toLocaleString('ko-KR') + '원';
    // 시연 정본 — 2분할 화면과 같은 값. 화면에는 'AI 예상 금액'으로만 보인다
    const fns = [
      { name: '예약 달력', date: '2026. 9. 18', amt: 1400000,
        work: '손님용 달력 · 회차 선택 화면과 가게용 정원 관리 화면, 정원이 차면 회차를 닫는 처리',
        days: '약 7일 · 화면 2개', vary: '회차가 요일마다 다르거나 좌석까지 고르게 하면 늘어날 수 있습니다' },
      { name: '예약금 결제', date: '2026. 9. 18', amt: 1200000,
        work: 'PG 결제 연동 1건, 결제 실패 · 취소 처리, 환불 규정 안내',
        days: '약 6일 · 화면 1개 + 결제 연동', vary: '환불 기준이 여러 단계이거나 부분 환불이 있으면 늘어날 수 있습니다' },
      { name: '노쇼 기록', date: '2026. 9. 20', amt: 1000000,
        work: '손님별 방문 기록 목록과 노쇼 표시, 다음 예약 화면에 횟수 표시',
        days: '약 5일 · 화면 1개', vary: '노쇼 손님의 예약을 자동으로 막는 기능을 더하면 늘어날 수 있습니다' },
      { name: '리마인드 알림', date: '2026. 9. 20', amt: 600000,
        work: '예약 전날 자동 발송 1종, 발송 대행 서비스 연동',
        days: '약 3일 · 연동 1건', vary: '알림 종류를 늘리거나 알림톡과 문자를 함께 쓰면 늘어날 수 있습니다' }
    ];
    if (over) fns.push({ name: '단골 등급 관리', date: '2026. 9. 22', amt: 660000,
        work: '방문 횟수 집계, 등급 3단계와 등급별 표시',
        days: '약 3~4일 · 화면 1개', vary: '등급별 할인 · 쿠폰을 자동으로 주면 늘어날 수 있습니다' });
    const sub = fns.reduce((t, f) => t + f.amt, 0);
    const fee = Math.floor(sub * 0.05);
    const total = sub + fee;
    const budget = 5000000;
    const rows = fns.map((f, i) => Object.assign({}, f, { cls: i === 0 ? 'fn first' : 'fn', amt: won(f.amt), pct: Math.round(f.amt / sub * 100) + '%' }));
    return {
      rows: rows, nIn: fns.length, making: making, hasOut: !over,
      sub: won(sub), fee: won(fee), total: won(total),
      under: total <= budget, over: total > budget, gap: won(Math.abs(budget - total))
    };
  }
}
