import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 공급자 — 계약·전자서명 */
export default class ContractSupplierScreen extends Screen {
  static override readonly id = "Contract-Supplier";
  static override readonly title = "공급자 — 계약·전자서명";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"state": {"editor": "enum", "options": ["상대가 먼저 서명", "아무도 서명 전", "내가 먼저 서명", "양쪽 서명 완료", "서명 거절 확인", "결렬 — 기한 초과"], "default": "상대가 먼저 서명", "section": "상태"}};


  renderVals(): Values {
    const view: string = '공급자';
    const st0 = this.props.state ?? '상대가 먼저 서명';
    const rejectOpen = st0 === '서명 거절 확인', broken = st0 === '결렬 — 기한 초과';
    const state = rejectOpen ? '상대가 먼저 서명' : (broken ? '아무도 서명 전' : st0);
    const isClient = view === '의뢰인';
    const won = (n: number) => n.toLocaleString('ko-KR');
    // 누가 서명했는지 — 공급자 / 의뢰인
    let sup = false, cli = false;
    if (state === '상대가 먼저 서명') { if (isClient) sup = true; else cli = true; }
    if (state === '내가 먼저 서명') { if (isClient) cli = true; else sup = true; }
    if (state === '양쪽 서명 완료') { sup = true; cli = true; }
    const both = sup && cli;
    const mine = isClient ? cli : sup;
    const other = isClient ? sup : cli;
    const signed = (on: boolean, at: string) => on ? { chip: '서명 완료', cls: 'teal', at: ' · 11월 4일 ' + at } : (broken ? { chip: '서명 안 함', cls: 'out', at: '' } : { chip: '대기 중', cls: 'amber', at: '' });
    const S = signed(sup, '15:20'), C = signed(cli, '16:05');
    let chip = '임시 계약 · 서명 대기', chipCls = 'amber';
    if (mine && !both) { chip = '임시 계약 · 상대 서명 대기'; chipCls = 'amber'; }
    if (both) { chip = isClient ? '계약 체결 · 예치 대기' : '계약 체결 · 의뢰인 예치 대기'; chipCls = isClient ? 'amber' : 'blue'; }
    if (broken) { chip = '결렬'; chipCls = 'out'; }
    return {
      isClient: isClient, isSupplier: !isClient,
      chip: chip, chipCls: chipCls,
      supChip: S.chip, supCls: S.cls, supAt: S.at,
      cliChip: C.chip, cliCls: C.cls, cliAt: C.at,
      canSign: !mine && !broken, waiting: mine && !both, bothSigned: both, pending: !both && !broken, broken: broken, rejectOpen: rejectOpen,
      signLabel: isClient ? (other ? '서명하고 예치하기' : '서명하기') : '서명하기',
      signHref: isClient && other ? 'Escrow-Client.dc.html' : (other ? '?state=양쪽+서명+완료' : '?state=내가+먼저+서명'),
      cancelTail: isClient ? '서명 기한 전에 임시 계약을 취소할 수 있습니다. 취소하면 결렬로 처리되고, 제안 비교에서 보류한 지원 중 다시 고르실 수 있습니다.' : '조건에 동의하지 않으면 서명을 거절하실 수 있습니다. 거절하면 바로 결렬되고 이 지원은 거절로 남습니다.',
      cancelLabel: isClient ? '임시 계약 취소' : '서명 거절',
      cancelHref: '?state=서명+거절+확인',
      waitText: isClient ? '최준호님이 11월 10일까지 서명하면 계약이 체결되고 대금을 예치할 수 있습니다.' : '정민재님이 11월 10일까지 서명하면 계약이 체결됩니다. 대금이 예치되면 작업을 시작합니다.',
      doneText: isClient ? '계약이 체결되었습니다. 3일 안(11월 7일까지)에 예치해 주세요 — 없으면 자동 결렬됩니다. 예치되면 보류했던 지원은 자동으로 거절되고, 예치 다음 날부터 작업 기간 42일이 시작됩니다.' : '계약이 체결되었습니다. 이제 채팅에서 연락처를 주고받을 수 있습니다. 의뢰인은 3일 안(11월 7일까지)에 예치해야 하고, 없으면 자동 결렬됩니다. 예치 다음 날부터 작업 기간 42일이 시작됩니다.'
    };
  }
}
