import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 의뢰인 공개 프로필 */
export default class PublicclientScreen extends Screen {
  static override readonly id = "PublicClient";
  static override readonly title = "공급자 — 의뢰인 공개 프로필";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "첫 거래"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const first = (this.props.view ?? '기본') === '첫 거래';
    const stats = first ? [
      { k: '등록한 프로젝트', v: '1건', s: '모집 중 1건', star: false },
      { k: '완료한 계약', v: '0건', s: '첫 거래입니다', star: false },
      { k: '평균 검수 기간', v: '—', s: '완료한 계약이 없습니다', star: false },
      { k: '받은 리뷰', v: '0건', s: '리뷰 없음', star: false }
    ] : [
      { k: '등록한 프로젝트', v: '4건', s: '모집 중 1건 · 완료 2건 · 결렬 1건', star: false },
      { k: '완료한 계약', v: '2건', s: '결렬 1건 · 취소 0건', star: false },
      { k: '평균 검수 기간', v: '1.5일', s: '납품부터 승인 · 보완 요청까지', star: false },
      { k: '받은 리뷰', v: '4.5', s: '리뷰 2건', star: true }
    ];
    const mk = (n: number) => ({ full: '★'.repeat(n), empty: '★'.repeat(5 - n), score: n });
    const reviews = [
      Object.assign({ who: '이도윤', date: '10월 2일', tags: ['검수가 빨랐어요', '요청 범위를 지켰어요', '다시 일하고 싶어요'],
        text: '계약에 없는 요청은 새 프로젝트로 나눠 주셔서 범위가 흔들리지 않았습니다. 검수도 이틀 안에 끝내 주셨어요.',
        ctx: '메뉴판 페이지, 오시는 길 외 1개 기능 · 합의 900,000원' }, mk(5)),
      Object.assign({ who: '한서진', date: '9월 20일', tags: ['조건을 분명히 정해 줬어요', '검수가 빨랐어요', '답장이 빨랐어요'],
        text: '처음 문의 때부터 무엇을 정해야 하는지 알고 계셔서 진행이 빨랐습니다. 검수 기준이 분명해서 좋았습니다.',
        ctx: '단체 예약 문의 폼 외 1개 기능 · 합의 700,000원' }, mk(4))
    ];
    return {
      stats: stats, hasRv: !first, noRv: first, rvCount: first ? '0건' : '2건 · 평균 ★ 4.5',
      tagc: [{ n: '검수가 빨랐어요', c: 2 }, { n: '조건을 분명히 정해 줬어요', c: 1 }, { n: '답장이 빨랐어요', c: 1 }, { n: '요청 범위를 지켰어요', c: 1 }, { n: '다시 일하고 싶어요', c: 1 }],
      reviews: first ? [] : reviews,
      projects: [{ title: '예약 달력, 예약금 결제 외 2개 기능', dl: '마감 11월 3일 · 2일 남음', meta: '음식점 · 명세 항목 4개 · 예산 400~500만원' }]
    };
  }
}
