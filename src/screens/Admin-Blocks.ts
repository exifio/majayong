import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 블록 검토 */
export default class AdminBlocksScreen extends Screen {
  static override readonly id = "Admin-Blocks";
  static override readonly title = "운영자 — 블록 검토";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["새 블록 목록", "병합", "단가 수정", "비활성화", "병합 완료", "단가 수정 완료", "비활성화 완료"], "default": "새 블록 목록", "section": "상태"}, "tab": {"editor": "enum", "options": ["새 블록", "병합 후보", "전체 블록"], "default": "새 블록", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '새 블록 목록';
    const done = /완료$/.test(v), base = v.replace(/ 완료$/, '');
    const price = base === '단가 수정', deact = base === '비활성화', merge = base === '병합';
    // [이름, 생성, 업종, 계기(문장에서 뽑은 기능 요약), AI 단가, 사용 중, 비슷한 블록, 유사도]
    type Row = [string, string, string, string, string, string, string, number];
    const R: Row[] = [
      ['노쇼 관리', '11월 2일 09:14', '음식점(코스)', '노쇼 손님을 표시하고 횟수를 기록', '950,000원', '초안 2 · 명세 0', '노쇼 기록', 92],
      ['알레르기 사전 접수', '11월 2일 08:30', '음식점(코스)', '예약할 때 손님의 알레르기 재료를 미리 받기', '550,000원', '초안 1 · 명세 1', '예약 메모', 41],
      ['반려동물 동반 표시', '11월 1일 19:02', '카페', '반려동물 동반 여부와 가능한 자리 표시', '650,000원', '초안 2 · 명세 0', '예약 메모', 54],
      ['와인 페어링 추천', '10월 31일 21:15', '음식점(와인 바)', '코스 메뉴별 어울리는 와인 추천', '900,000원', '초안 1 · 명세 0', '비슷한 블록 없음', 23],
      ['주차 안내', '10월 31일 16:40', '음식점(한식)', '주차 가능 여부와 제휴 주차장 안내', '800,000원', '초안 3 · 명세 1', '오시는 길', 35],
      ['수강권 차감', '10월 30일 11:20', '공방', '수업에 올 때마다 수강권 횟수를 차감', '1,050,000원', '초안 1 · 명세 0', '예약금 결제', 38],
      ['방문 후 리뷰 요청', '10월 30일 10:05', '음식점(코스)', '방문 다음 날 리뷰를 부탁하는 알림 발송', '450,000원', '초안 0 · 명세 0', '리마인드 알림', 71]
    ];
    const selName = price ? '주차 안내' : (deact ? '방문 후 리뷰 요청' : '노쇼 관리');
    // 탭(`?tab=`)은 같은 목록을 거른다(2-5) — 새 블록 · 병합 후보(유사도 70% 이상) · 전체 블록.
    // 처리한 블록은 새 블록 · 병합 후보에서 빠지고 전체 블록에는 남는다.
    const tab: string = this.props.tab ?? '새 블록';
    const all = tab === '전체 블록', candTab = tab === '병합 후보';
    const q = (view: string) => '?view=' + view.replace(/ /g, '+');
    // 행을 고르면 그 블록을 상세로 보여 주는 상태(2-4). 상세가 있는 블록은 셋뿐이라 나머지는 기본 목록 상태로.
    const rowView = (name: string) => name === selName ? v
      : name === '주차 안내' ? '단가 수정' : name === '방문 후 리뷰 요청' ? '비활성화' : '새 블록 목록';
    const rows = R.filter(r => all || (!(done && r[0] === selName) && (!candTab || r[7] >= 70))).map((r, i) => ({ cls: 'bl-row' + (i === 0 ? ' first' : '') + ((!done || all) && r[0] === selName ? ' sel' : ''), name: r[0], when: r[1], ind: r[2], why: r[3], price: r[4], use: r[5],
      simName: r[6], sim: r[7] >= 30 ? '유사도 ' + r[7] + '%' : '최고 ' + r[7] + '%', simCls: r[7] >= 70 ? 'hi' : '', cand: r[7] >= 70, href: q(rowView(r[0])) }));
    const D = {
      '노쇼 관리': { name: '노쇼 관리', chip: '병합 후보', chipCls: 'chip amber', when: '11월 2일 09:14', ind: '음식점(코스)', use: '초안 2 · 명세 0',
        sum: '노쇼 손님을 표시하고 노쇼 횟수를 기록해 다음 예약 때 보여 줍니다.', decs: ['노쇼 횟수 기준', '표시 위치'],
        wf1: '손님 목록 · 노쇼 표시', wf2: '예약 상세 · 횟수', price: '950,000원',
        work: '손님별 방문 기록 목록과 노쇼 표시, 다음 예약 화면에 횟수 표시', days: '약 5일 · 화면 1개', vary: '노쇼 손님 예약을 자동으로 막으면 늘어날 수 있음',
        simName: '노쇼 기록', sim: '유사도 92%',
        cmp: [{ k: '기능 요약', a: '노쇼 손님 표시 · 횟수 기록', b: '노쇼 손님을 기록해 다음 예약 때 표시' }, { k: '정할 것', a: '노쇼 횟수 기준 · 표시 위치', b: '노쇼 판정 기준 · 표시 방식' }, { k: 'AI 단가', a: '950,000원', b: '1,000,000원' }, { k: '사용 중', a: '초안 2건', b: '초안 · 명세 · 계약 12건' }] },
      '주차 안내': { name: '주차 안내', chip: '새 블록', chipCls: 'chip blue', when: '10월 31일 16:40', ind: '음식점(한식)', use: '초안 3 · 명세 1',
        sum: '방문 전에 주차 가능 여부와 제휴 주차장 위치 · 요금을 손님에게 안내합니다.', decs: ['제휴 주차장 범위', '안내 시점'],
        wf1: '예약 확인 · 주차 안내', wf2: '가게 · 주차장 설정', price: '800,000원',
        work: '예약 확인 화면의 주차 안내와 가게용 주차장 설정 화면', days: '약 4일 · 화면 2개', vary: '주차 가능 대수를 실시간으로 보여 주면 늘어날 수 있음',
        simName: '오시는 길', sim: '유사도 35%',
        cmp: [{ k: '기능 요약', a: '주차 가능 여부 · 제휴 주차장 안내', b: '가게 위치 지도와 찾아오는 길 안내' }, { k: '정할 것', a: '제휴 주차장 범위 · 안내 시점', b: '지도 종류 · 표시 정보' }, { k: 'AI 단가', a: '800,000원', b: '500,000원' }, { k: '사용 중', a: '초안 3 · 명세 1', b: '초안 · 명세 · 계약 14건' }] },
      '방문 후 리뷰 요청': { name: '방문 후 리뷰 요청', chip: '새 블록', chipCls: 'chip blue', when: '10월 30일 10:05', ind: '음식점(코스)', use: '초안 0 · 명세 0',
        sum: '방문 다음 날 손님에게 리뷰를 부탁하는 알림을 보냅니다.', decs: ['발송 시점', '발송 수단'],
        wf1: '알림 문구 설정', wf2: '발송 기록', price: '450,000원',
        work: '방문 기록을 기준으로 다음 날 알림 발송 · 문구 설정', days: '약 2일 · 화면 1개', vary: '리뷰 사이트 연동을 넣으면 늘어날 수 있음',
        simName: '리마인드 알림', sim: '유사도 71%',
        cmp: [{ k: '기능 요약', a: '방문 다음 날 리뷰 부탁 알림', b: '예약 전날 손님에게 안내 자동 발송' }, { k: '정할 것', a: '발송 시점 · 발송 수단', b: '발송 시점 · 발송 수단' }, { k: 'AI 단가', a: '450,000원', b: '600,000원' }, { k: '사용 중', a: '초안 0 · 명세 0', b: '초안 18 · 명세 9' }] }

    };
    const d = Object.assign({ amtK: 'AI 단가 · 생성 때 고정', old: '' }, D[selName]);
    let dn = {}, rs = {};
    if (done && merge) {
      Object.assign(d, { chip: '병합됨', chipCls: 'chip out' });
      dn = { t: '‘노쇼 관리’를 ‘노쇼 기록’에 병합했습니다 · 11월 4일 14:20 · 운영자 김하늘', p: '‘노쇼 관리’는 이후 매칭 · 추천에서 빠지고, 같은 기능은 ‘노쇼 기록’으로 분류됩니다. 이미 쓴 초안 2건은 그대로입니다.' };
      rs = { t: '‘노쇼 기록’에 병합됨 · 11월 4일 14:20 · 김하늘', why: '기능 요약과 정할 것이 ‘노쇼 기록’과 같고 이름만 다릅니다.', btn: '‘노쇼 기록’ 블록 보기', href: '#block' };
    } else if (done && price) {
      Object.assign(d, { chip: '단가 수정됨', chipCls: 'chip teal', amtK: 'AI 단가 · 11월 4일 수정', old: '800,000원', price: '950,000원' });
      dn = { t: '‘주차 안내’ 단가를 950,000원으로 고쳤습니다 · 11월 4일 14:22 · 운영자 김하늘', p: '이 시각 뒤에 만들어지는 초안부터 950,000원이 쓰입니다. 기존 초안 3건 · 명세 1건의 금액은 그대로입니다.' };
      rs = { t: '단가 800,000원 → 950,000원 · 11월 4일 14:22 · 김하늘', why: '제휴 주차장 요금 계산과 주차권 안내 문자 발송이 근거에서 빠져 작업량이 적게 잡혔습니다.', btn: '단가 수정 기록 보기', href: 'Admin-Events.dc.html?type=단가+수정' };
    } else if (done && deact) {
      Object.assign(d, { chip: '비활성', chipCls: 'chip out' });
      dn = { t: '‘방문 후 리뷰 요청’을 비활성화했습니다 · 11월 4일 14:25 · 운영자 김하늘', p: '이후 매칭 · 추천에서 빠집니다. 블록은 지우지 않았고, 전체 블록 탭에서 다시 켤 수 있습니다.' };
      rs = { t: '비활성 · 11월 4일 14:25 · 김하늘', why: '방문 다음 날 안내는 ‘리마인드 알림’의 발송 시점 조건으로 다룰 수 있어 따로 둘 블록이 아닙니다.', btn: '다시 켜기', href: '#activate' };
    }
    return { rows: rows, d: d, dn: dn, rs: rs, done: done, notDone: !done,
      nNew: done ? 6 : 7, nCand: done && merge ? 1 : 2, nLog: done && price ? 4 : 3,
      tabNew: tab === '새 블록' ? 'on' : '', tabCand: candTab ? 'on' : '', tabAll: all ? 'on' : '',
      isMerge: v === '병합', isPrice: v === '단가 수정', isDeact: v === '비활성화' };
  }
}
