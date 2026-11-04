import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

// [별점, 날짜, 업종, 프로젝트, 태그, 본문]
type ReviewRow = [number, string, string, string, string[], string];
type TagCount = [string, number];

/** 의뢰인 — 공급자 공개 프로필 */
export default class PublicsupplierScreen extends Screen {
  static override readonly id = "PublicSupplier";
  static override readonly title = "의뢰인 — 공급자 공개 프로필";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본", "리뷰 없음"], "default": "기본", "section": "상태"}};


  renderVals(): Values {
    const nut = (this.props.view ?? '기본') === '리뷰 없음';
    const I = {
      link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
      file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5'
    };
    const tagsAll: TagCount[] = [['일정을 지켰어요', 10], ['조건대로 만들었어요', 9], ['다시 맡기고 싶어요', 8], ['설명이 쉬웠어요', 7], ['보완 요청에 빨리 답했어요', 6]];
    const R: ReviewRow[] = [
      [5, '10월 20일', '음식점(한식 주점)', '테이블 예약, 대기 등록 외 2개 기능', ['설명이 쉬웠어요', '일정을 지켰어요'], '대기 등록 화면을 직원들이 바로 쓸 수 있게 만들어 주셨습니다. 관리 화면 사용법도 짧게 정리해 주셨어요.'],
      [5, '9월 28일', '음식점(이탈리안)', '코스 예약, 와인 리스트 외 1개 기능', ['일정을 지켰어요', '조건대로 만들었어요', '다시 맡기고 싶어요'], '예약 마감 시각처럼 제가 미처 생각 못 한 부분을 채팅에서 먼저 물어봐 주셔서 좋았습니다. 보완 요청도 하루 만에 고쳐 주셨어요.'],
      [4, '8월 24일', '베이커리', '케이크 예약, 픽업 시간 선택 외 1개 기능', ['조건대로 만들었어요', '보완 요청에 빨리 답했어요'], '픽업 시간 선택이 정해진 조건대로 잘 됩니다. 디자인은 조금 더 다듬고 싶었지만 범위 안에서 꼼꼼하게 해 주셨습니다.'],
      [5, '7월 9일', '카페', '원두 정기배송 신청 외 1개 기능', ['다시 맡기고 싶어요', '일정을 지켰어요'], '마감보다 사흘 먼저 납품해 주셨고, 결제 연동 테스트까지 같이 봐 주셨습니다.']
    ];
    const reviews = R.map(r => ({ stars: '★'.repeat(r[0]) + '☆'.repeat(5 - r[0]), d: r[1], who: r[2], ct: r[3], tags: r[4], tx: r[5] }));
    return nut ? {
      name: '스튜디오 넛', ini: '넛', role: '제작사 · 경력 9년', hasRv: false, noRv: true, rvText: '리뷰 없음', done: 0, joined: '2026년 10월 가입',
      inds: ['예약 기반 음식점', '카페 · 베이커리'], stack: ['Next.js', 'Figma', 'Supabase'],
      bio: '디자이너 2명, 개발자 3명이 함께하는 웹 제작사입니다. 브랜드 디자인부터 예약 사이트까지 한 팀이 맡습니다.',
      hasSum: false, noSum: true,
      links: [{ icon: I.link, t: 'studio-nut.kr/works', s: '작업 사례 모음' }, { icon: I.link, t: 'behance.net/studionut', s: '디자인 포트폴리오' }],
      dist: [], tt: [], reviews: [],
      qRound: '1회차 · 11월 1일 지원', qAmt: '4,500,000원', qFee: '4,725,000원', qDays: '56일', qOk: '3 / 4'
    } : {
      name: '최준호', ini: '최', role: '웹 외주 프리랜서 · 경력 5년', hasRv: true, noRv: false, rvText: '리뷰 12건', done: 12, joined: '2025년 가입',
      inds: ['예약 기반 음식점'], stack: ['React', 'Next.js', 'Supabase'],
      bio: '예약·결제 연동 위주로 작업해 온 웹 개발 프리랜서입니다. 소규모 식당 사이트를 열두 곳 만들었습니다.',
      hasSum: true, noSum: false,
      sum: '소규모 식당 예약 사이트 12곳을 만들었습니다. 예약 달력과 PG 결제 연동 작업이 대부분이고, 가장 최근 작업은 회차제 코스 레스토랑의 예약 사이트입니다.',
      links: [{ icon: I.link, t: 'junho.work', s: '작업 사례와 소개' }, { icon: I.link, t: 'junho-works.kr/booking', s: '최근 작업 — 회차제 코스 레스토랑 예약' }, { icon: I.file, t: '작업소개서.pdf', s: 'PDF · 올린 파일' }],
      dist: [[5, 10], [4, 2], [3, 0], [2, 0], [1, 0]].map(d => ({ s: d[0], n: d[1], w: 'width:' + Math.round(d[1] / 12 * 100) + '%' })),
      tt: tagsAll.map(t => ({ n: t[0], c: t[1], w: 'width:' + Math.round(t[1] / 12 * 100) + '%' })),
      reviews: reviews,
      qRound: '2회차 · 11월 1일 채팅에서 수정', qAmt: '3,100,000원', qFee: '3,255,000원', qDays: '42일', qOk: '4 / 4'
    };
  }
}
