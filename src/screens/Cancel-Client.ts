import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 계약 취소 요청 */
export default class CancelClientScreen extends Screen {
  static override readonly id = "Cancel-Client";
  static override readonly title = "의뢰인 — 계약 취소 요청";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["요청 작성", "공급자 사정 선택", "동의 대기", "이견 — 운영자 판정 중", "정산 확정"], "default": "요청 작성", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '요청 작성';
    const supR = v === '공급자 사정 선택';
    const write = v === '요청 작성' || supR;
    const wait = v === '동의 대기', disp = v === '이견 — 운영자 판정 중', done = v === '정산 확정';
    const sel = (supR || disp) ? 1 : 0;
    const R = [
      ['의뢰인 사정', '예치 후 24시간 안 · 납품 전이면 전액 환불. 그 뒤 납품 전이면 진행 중 구간의 50% 이상을 공급자에게 보상하고, 납품한 구간은 전액 지급합니다.'],
      ['공급자 사정', '공급자가 일정을 지키지 못하거나 연락이 끊긴 경우 등. 지급되지 않은 구간을 전액 환불합니다.'],
      ['서로 합의', '두 분이 정한 비율로 진행 중 구간의 일부를 보상합니다.']
    ];
    const reasons = R.map((r, i) => ({ name: r[0], rule: r[1], isAgree: i === 2 && write,
      on: i === sel, off: i !== sel, cls: 'lbl' + (i === sel ? ' on' : '') + (write ? '' : ' ro') }));
    const won = (n: number) => n.toLocaleString('ko-KR') + '원';
    const rowsClient = [
      { cls: 'r', k: '예치한 금액', s: '합의 3,100,000원 + 수수료 155,000원', v: '3,255,000원' },
      { cls: 'r', k: '− 공급자 보상', s: '진행 중 구간 1,550,000원의 50%', v: '− 775,000원' },
      { cls: 'r', k: '− 보상분 수수료 5%', s: '지급이 확정된 775,000원에만', v: '− 38,750원' },
      { cls: 'r tot', k: '돌려받을 금액', s: '남은 금액 2,325,000원 + 남은 수수료 116,250원', v: '2,441,250원' },
      { cls: 'r sup', k: '최준호님이 받는 금액', s: '보상 775,000원 − 수수료 5%', v: '736,250원' }
    ];
    const rowsSup = [
      { cls: 'r', k: '예치한 금액', s: '합의 3,100,000원 + 수수료 155,000원', v: '3,255,000원' },
      { cls: 'r', k: '− 공급자 보상', s: '지급된 구간이 없어 보상 없음', v: '0원' },
      { cls: 'r tot', k: '돌려받을 금액', s: '수수료까지 전액', v: '3,255,000원' },
      { cls: 'r sup', k: '최준호님이 받는 금액', s: '', v: '0원' }
    ];
    const rowsDisp = [
      { cls: 'r', k: '예치한 금액', s: '합의 3,100,000원 + 수수료 155,000원', v: '3,255,000원' },
      { cls: 'r tot', k: '공급자 사정으로 판정되면', s: '지급된 구간이 없어 전액 환불 · 최준호님 0원', v: '3,255,000원' },
      { cls: 'r tot', k: '의뢰인 사정으로 판정되면', s: '보상 775,000원 − 보상분 수수료 38,750원을 뺀 금액 · 최준호님 736,250원', v: '2,441,250원' }
    ];
    return {
      isWrite: write, isWait: wait, isDispute: disp, isDone: done, isDoneOrWait: !write,
      title: done ? '취소 정산 확정' : (write ? '계약 취소 요청' : '취소 요청 중'),
      sub: write ? '예치가 끝난 계약을 취소합니다. 사유를 고르면 정산이 어떻게 되는지 바로 보여 드립니다.'
                 : '보낸 취소 요청의 진행 상황입니다. 결과는 내 계약과 정산 내역에도 표시됩니다.',
      stChip: done ? '취소됨' : (write ? '진행 중' : '취소 요청'), stChipCls: done ? 'chip out' : (write ? 'chip blue' : 'chip amber'),
      reasons: reasons,
      rsReq: write ? '필수' : '', txReq: write ? '필수' : '',
      txt: disp ? '11월 6일까지 예약 달력 진행 화면을 공유받기로 했는데 받지 못했고, 사흘 동안 답장이 없어 진행을 믿기 어렵습니다.' : '가게 리모델링 일정이 12월로 잡혀 예약 사이트 오픈을 내년으로 미루게 되었습니다. 진행해 주신 부분은 규정대로 보상하겠습니다.',
      hasAtt: !write || v === '요청 작성', attTxt: disp ? '채팅 · 11월 4일 "진행 화면은 6일까지 보여 드릴게요"' : '채팅 · 11월 7일 "오픈을 미뤄야 할 것 같아요"',
      pvH: write ? '정산 미리보기' : (done ? '확정된 정산' : (disp ? '판정에 따른 정산' : '요청한 정산')),
      pvTag: supR ? '공급자 사정 · 지급된 구간 없음' : (disp ? '판정 결과에 따라 둘 중 하나로 정산' : '의뢰인 사정 · 예치 후 24시간 지남 · 납품 전'),
      rows: disp ? rowsDisp : (supR ? rowsSup : rowsClient)
    };
  }
}
