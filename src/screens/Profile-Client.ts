import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 내 프로필 */
export default class ProfileClientScreen extends Screen {
  static override readonly id = "Profile-Client";
  static override readonly title = "의뢰인 — 내 프로필";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["기본 정보", "받은 리뷰"], "default": "기본 정보", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '기본 정보';
    const rv = v === '받은 리뷰';
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
      basic: !rv, rv: rv, tabBasic: rv ? '' : 'on', tabRv: rv ? 'on' : '',
      tagc: [{ n: '검수가 빨랐어요', c: 2 }, { n: '조건을 분명히 정해 줬어요', c: 1 }, { n: '답장이 빨랐어요', c: 1 }, { n: '요청 범위를 지켰어요', c: 1 }, { n: '다시 일하고 싶어요', c: 1 }],
      reviews: reviews
    };
  }
}
