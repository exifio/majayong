import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 리뷰 작성 */
export default class ReviewClientScreen extends Screen {
  static override readonly id = "Review-Client";
  static override readonly title = "의뢰인 — 리뷰 작성";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["작성 중", "제출함"], "default": "작성 중", "section": "상태"}};


  renderVals(): Values {
    const sup = ('의뢰인' as string) === '공급자';
    const done = (this.props.view ?? '작성 중') === '제출함';
    const st = this.state || {};
    const score = typeof st.rating === 'number' ? st.rating : (sup ? 5 : 5);
    const TC = ['일정을 지켰어요', '설명이 쉬웠어요', '조건대로 만들었어요', '보완 요청에 빨리 답했어요', '다시 맡기고 싶어요'];
    const TS = ['조건을 분명히 정해 줬어요', '검수가 빨랐어요', '답장이 빨랐어요', '요청 범위를 지켰어요', '다시 일하고 싶어요'];
    const pickC = [0, 2, 3, 4], pickS = [0, 1, 3];
    const T = sup ? TS : TC;
    const pick: number[] = Array.isArray(st.tags) ? (st.tags as number[]) : (sup ? pickS : pickC);
    const textC = '예약금 환불 기준처럼 제가 미처 생각 못 한 부분을 채팅에서 먼저 물어봐 주셔서 좋았습니다. 보완 요청도 하루 만에 고쳐 주셨어요. 전화 예약이 눈에 띄게 줄었습니다.';
    const textS = '정할 것을 채팅에서 하나씩 분명히 정해 주셔서 작업 중에 다시 묻는 일이 거의 없었습니다. 검수도 이틀 안에 끝내 주셨어요.';
    const text = sup ? textS : textC;
    const words = ['', '별로였어요', '아쉬웠어요', '보통이에요', '좋았어요', '아주 좋았어요'];
    return {
      isClient: !sup, isSupplier: sup, isWrite: !done, isDone: done,
      title: done ? '보낸 리뷰' : (sup ? '의뢰인 평가하기' : '공급자 평가하기'),
      sub: sup ? '함께 일한 의뢰인은 어땠나요? 다른 공급자가 이 의뢰인의 프로젝트에 지원할 때 참고합니다.'
               : '함께 일한 공급자는 어땠나요? 다른 의뢰인이 공급자를 고를 때 참고합니다.',
      ava: sup ? '정' : '최',
      who: sup ? '정민재 · 온도 다이닝' : '최준호',
      whoShort: sup ? '정민재' : '최준호',
      whoMeta: sup ? '음식점(코스 레스토랑) · 서울 마포구' : '웹 외주 프리랜서 5년 차 · ★ 4.8 · 리뷰 12건',
      starHint: '1점부터 5점까지 고릅니다.',
      stars: [1, 2, 3, 4, 5].map(n => ({ n: n, cls: n <= score ? 'on' : 'off', chk: n === score ? 'true' : 'false', pick: () => this.setState({ rating: n }) })),
      score: score, scoreWord: words[score],
      tagWhere: sup ? '의뢰인 공개 프로필' : '공급자 공개 프로필',
      tags: T.map((t, i) => ({ name: t, cls: pick.includes(i) ? 'on' : '', p: pick.includes(i) ? 'true' : 'false',
        pick: () => this.setState({ tags: pick.includes(i) ? pick.filter(j => j !== i) : [...pick, i].sort((a, b) => a - b) }) })),
      txHint: sup ? '작업하면서 좋았던 점이나 아쉬웠던 점을 적어 주세요.' : '결과물과 일하는 방식에서 좋았던 점이나 아쉬웠던 점을 적어 주세요.',
      text: text, len: text.length,
      where: sup ? '별점과 리뷰는 정민재님의 공개 프로필에 보입니다.'
                 : '별점과 리뷰는 최준호님의 공개 프로필에, 평균 별점과 리뷰 수는 제안 비교 카드에도 보입니다.',
      myTags: pick.map(i => T[i]),
      theyWrote: !sup, theyWait: sup,
      theirTags: sup ? [] : ['조건을 분명히 정해 줬어요', '답장이 빨랐어요'],
      theirText: '처음 문의 때부터 무엇을 정해야 하는지 알고 계셔서 진행이 빨랐습니다. 검수 기준이 분명해서 좋았습니다.',
      doneNote: sup ? '받은 리뷰는 내 공개 프로필과 제안 비교 카드의 평균 별점에 더해집니다.' : '받은 리뷰는 내 공개 프로필에 보입니다.'
    };
  }
}
