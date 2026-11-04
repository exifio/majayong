import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 보류된 결제 */
export default class AdminPaymentsScreen extends Screen {
  static override readonly id = "Admin-Payments";
  static override readonly title = "운영자 — 보류된 결제";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["목록", "금액 불일치", "확정"], "default": "목록", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '목록';
    const mis = v === '금액 불일치', done = v === '확정';
    const A = { href: '?view=목록', chip: '결과 통지 없음', chipCls: 'chip amber', tm: '11월 4일 14:12 · 40분째', nm: '골목 파스타 · 2,100,000원', ds: '저녁 코스 예약, 예약금 결제 외 1개 기능 · 공급자 한서진' };
    const B = { href: '?view=금액+불일치', chip: '금액 불일치', chipCls: 'chip amber', tm: '11월 3일 20:41', nm: '면옥 · 2,100,000원', ds: '포장 주문, 픽업 시간 선택 외 2개 기능 · 공급자 김세라' };
    let items = done ? [B] : [A, B];
    const selIdx = done ? -1 : (mis ? 1 : 0);
    items = items.map((x, i) => Object.assign({}, x, { cls: 'py-it' + (i === 0 ? ' first' : '') + (i === selIdx ? ' sel' : '') }));
    // [결제사에 다시 조회] — 같은 화면에서 값만 바뀐다(2-6). 일치하면 기본 상태가 이미 조회 뒤 모습, 불일치면 그대로 금액 불일치
    const dA = {
      title: '골목 파스타 · 예치 2,100,000원', meta: '결제 요청 11월 4일 14:12 · 결제 건 •••3307', chip: done ? '예치 완료로 확정' : '보류 · 결과 통지 없음', chipCls: done ? 'chip teal' : 'chip amber',
      bandCls: done ? 'py-band tl' : 'py-band gr',
      bandB: done ? '예치 완료로 확정했습니다 · 14:53' : '결제사는 승인했지만 결과 통지가 40분째 오지 않았습니다',
      bandP: done ? '의뢰인 · 공급자 화면이 예치 완료로 바뀌고, 작업 기간 30일이 내일부터 시작됩니다(마감 12월 4일).' : '14:52에 결제사에 다시 조회해 승인 기록을 받았습니다. 금액이 요청과 같습니다. 통지가 누락된 것으로 보입니다.',
      cmp: [{ cls: '', k: '금액', a: '2,100,000원', b: '2,100,000원' }, { cls: '', k: '승인', a: '—', b: '14:12 승인' }, { cls: '', k: '결과 통지', a: '기다림', b: '보낸 기록 없음' }, { cls: '', k: '결제 건', a: '•••3307', b: '•••3307' }],
      ct: '저녁 코스 예약, 예약금 결제 외 1개 기능', cl: '배수아 · 골목 파스타', sp: '한서진', method: '카드 · 끝자리 1093',
      key: '•••3307 + 2,100,000 + 11/04 14:12 → k_7f3a…e91c',
      flow: done
        ? [{ cls: '', b: '14:12 · 결제 요청', s: '의뢰인이 2,100,000원 결제' }, { cls: '', b: '14:12 · 결제사 승인', s: '결제사 기록' }, { cls: '', b: '14:52 · 다시 조회', s: '승인 · 금액 일치 확인' }, { cls: '', b: '14:53 · 예치 완료로 확정', s: '운영자 김하늘' }]
        : [{ cls: '', b: '14:12 · 결제 요청', s: '의뢰인이 2,100,000원 결제' }, { cls: '', b: '14:12 · 결제사 승인', s: '다시 조회로 확인한 기록' }, { cls: '', b: '14:22 · 자동 보류', s: '10분 안에 결과 통지가 없어 예치 완료로 바꾸지 않음' }, { cls: 'now', b: '지금 · 운영자 확인', s: '14:52 다시 조회 · 금액 일치' }],
      why: '결제사 조회로 승인 2,100,000원을 확인했습니다. 결과 통지만 오지 않았습니다.',
      cancelCls: 'btn sm gh', okCls: 'btn sm', okHref: '?view=확정', requeryHref: '?view=목록', hasOkWhy: false, okWhy: '',
      note: done ? '같은 결제 건으로 결과 통지가 뒤늦게 오면 중복 방지 키로 걸러 예치가 두 번 잡히지 않습니다.' : "확정 전까지 의뢰인 화면은 '확인 중'으로 보이고 다시 결제를 받지 않습니다."
    };
    const dB = {
      title: '면옥 · 예치 2,100,000원', meta: '결제 요청 11월 3일 20:41 · 결제 건 •••7730', chip: '보류 · 금액 불일치', chipCls: 'chip amber',
      bandCls: 'py-band am', bandB: '결제사 기록 금액이 요청과 90,000원 다릅니다',
      bandP: '요청은 2,100,000원인데 결제사는 2,010,000원 승인으로 통지했습니다. 금액이 맞지 않으면 예치 완료로 확정할 수 없습니다.',
      cmp: [{ cls: 'diff', k: '금액', a: '2,100,000원', b: '2,010,000원' }, { cls: '', k: '승인', a: '—', b: '20:41 승인' }, { cls: '', k: '결과 통지', a: '기다림', b: '20:41 받음' }, { cls: '', k: '결제 건', a: '•••7730', b: '•••7730' }],
      ct: '포장 주문, 픽업 시간 선택 외 2개 기능', cl: '이정훈 · 면옥', sp: '김세라', method: '계좌이체 · 끝자리 5512',
      key: '•••7730 + 2,100,000 + 11/03 20:41 → k_2c91…04ad',
      flow: [{ cls: '', b: '20:41 · 결제 요청', s: '의뢰인이 2,100,000원 결제' }, { cls: '', b: '20:41 · 결과 통지', s: '결제사가 2,010,000원 승인으로 통지' }, { cls: '', b: '20:41 · 자동 보류', s: '금액 불일치로 예치 완료로 바꾸지 않음' }, { cls: 'now', b: '지금 · 운영자 확인', s: '결제사에 차액 확인 요청 중' }],
      why: '결제사 승인 금액이 2,010,000원으로 요청과 다릅니다. 이 결제를 취소하고 의뢰인에게 다시 결제를 요청합니다.',
      cancelCls: 'btn sm', okCls: 'btn sm off', okHref: '#confirm', requeryHref: '?view=금액+불일치', hasOkWhy: true, okWhy: '금액이 맞지 않아 확정할 수 없습니다 — 결제사 기록이 요청과 같아야 합니다',
      note: '취소하면 승인된 2,010,000원은 결제사를 통해 의뢰인에게 돌아가고, 의뢰인 화면에는 "결제가 완료되지 않았습니다 · 다시 결제하기"가 보입니다.'
    };
    return { items: items, d: mis ? dB : dA, isOpen: !done, isDone: done, hasDone: done, nHold: done ? 1 : 2, nDone: done ? 1 : 0 };
  }
}
