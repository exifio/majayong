import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

// [별점, 날짜, 업종, 프로젝트, 태그, 본문]
type ReviewRow = [number, string, string, string, string[], string];
type TagCount = [string, number];

/** 공급자 — 내 프로필 */
export default class ProfileSupplierScreen extends Screen {
  static override readonly id = "Profile-Supplier";
  static override readonly title = "공급자 — 내 프로필";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본 정보", "받은 리뷰"], "default": "기본 정보", "section": "화면"}, "summary": {"editor": "enum", "options": ["공개 중", "확인 대기", "숨김"], "default": "공개 중", "section": "상태"}};


  renderVals(): Values {
    const st = this.props.summary ?? '공개 중';
    const rv = (this.props.view ?? '기본 정보') === '받은 리뷰';
    // 공개 프로필(PublicSupplier)과 같은 리뷰 데이터
    const R: ReviewRow[] = [
      [5, '10월 20일', '음식점(한식 주점)', '테이블 예약, 대기 등록 외 2개 기능', ['설명이 쉬웠어요', '일정을 지켰어요'], '대기 등록 화면을 직원들이 바로 쓸 수 있게 만들어 주셨습니다. 관리 화면 사용법도 짧게 정리해 주셨어요.'],
      [5, '9월 28일', '음식점(이탈리안)', '코스 예약, 와인 리스트 외 1개 기능', ['일정을 지켰어요', '조건대로 만들었어요', '다시 맡기고 싶어요'], '예약 마감 시각처럼 제가 미처 생각 못 한 부분을 채팅에서 먼저 물어봐 주셔서 좋았습니다. 보완 요청도 하루 만에 고쳐 주셨어요.'],
      [4, '8월 24일', '베이커리', '케이크 예약, 픽업 시간 선택 외 1개 기능', ['조건대로 만들었어요', '보완 요청에 빨리 답했어요'], '픽업 시간 선택이 정해진 조건대로 잘 됩니다. 디자인은 조금 더 다듬고 싶었지만 범위 안에서 꼼꼼하게 해 주셨습니다.'],
      [5, '7월 9일', '카페', '원두 정기배송 신청 외 1개 기능', ['다시 맡기고 싶어요', '일정을 지켰어요'], '마감보다 사흘 먼저 납품해 주셨고, 결제 연동 테스트까지 같이 봐 주셨습니다.']
    ];
    const tagsAll: TagCount[] = [['일정을 지켰어요', 10], ['조건대로 만들었어요', 9], ['다시 맡기고 싶어요', 8], ['설명이 쉬웠어요', 7], ['보완 요청에 빨리 답했어요', 6]];
    return {
      isRv: rv, isBasic: !rv, tabB: rv ? '' : 'on', tabR: rv ? 'on' : '',
      dist: [[5, 10], [4, 2], [3, 0], [2, 0], [1, 0]].map(d => ({ s: d[0], n: d[1], w: 'width:' + Math.round(d[1] / 12 * 100) + '%' })),
      tt: tagsAll.map(t => ({ n: t[0], c: t[1], w: 'width:' + Math.round(t[1] / 12 * 100) + '%' })),
      reviews: R.map(r => ({ stars: '★'.repeat(r[0]) + '☆'.repeat(5 - r[0]), d: r[1], who: r[2], ct: r[3], tags: r[4], tx: r[5] })),
      chip: st === '공개 중' ? '공개 중' : (st === '확인 대기' ? '확인 대기' : '숨김'),
      chipCls: st === '공개 중' ? 'chip teal' : (st === '확인 대기' ? 'chip amber' : 'chip out'),
      hasText: st !== '숨김', isHidden: st === '숨김', isDraft: st === '확인 대기', canHide: st === '공개 중'
    };
  }
}
