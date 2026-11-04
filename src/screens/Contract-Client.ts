import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 의뢰인 — 계약·전자서명 */
export default class ContractClientScreen extends Screen {
  static override readonly id = "Contract-Client";
  static override readonly title = "의뢰인 — 계약·전자서명";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"state": {"editor": "enum", "options": ["상대가 먼저 서명", "아무도 서명 전", "내가 먼저 서명", "양쪽 서명 완료", "결렬 — 공급자 서명 거절", "결렬 — 기한 초과", "임시 계약 취소 확인", "결렬 — 임시 계약 취소함"], "default": "상대가 먼저 서명", "section": "상태"}};


  renderVals(): Values {
    const view = '의뢰인';
    const state = this.props.state ?? '상대가 먼저 서명';
    const isClient = view === '의뢰인';
    const won = (n: number) => n.toLocaleString('ko-KR');
    // 누가 서명했는지 — 공급자 / 의뢰인
    let sup = false, cli = false;
    const refused = state === '결렬 — 공급자 서명 거절', expired = state === '결렬 — 기한 초과', canceled = state === '결렬 — 임시 계약 취소함', broke = refused || expired || canceled;
    const cancelM = state === '임시 계약 취소 확인';
    if (state === '상대가 먼저 서명' || cancelM) { if (isClient) sup = true; else cli = true; }
    if (state === '내가 먼저 서명') { if (isClient) cli = true; else sup = true; }
    if (state === '양쪽 서명 완료') { sup = true; cli = true; }
    const both = sup && cli;
    const mine = isClient ? cli : sup;
    const other = isClient ? sup : cli;
    const signed = (on: boolean, at: string) => on ? { chip: '서명 완료', cls: 'teal', at: ' · 11월 4일 ' + at } : { chip: '대기 중', cls: 'amber', at: '' };
    const S = signed(sup, '11:20'), C = signed(cli, '13:05');
    let chip = '임시 계약 · 서명 대기', chipCls = 'amber';
    if (broke) { chip = '결렬'; chipCls = 'out'; }
    if (mine && !both) { chip = '임시 계약 · 상대 서명 대기'; chipCls = 'amber'; }
    if (both) { chip = isClient ? '계약 체결 · 예치 대기' : '계약 체결 · 의뢰인 예치 대기'; chipCls = isClient ? 'amber' : 'blue'; }
    const supSt = canceled ? { chip: '서명함', cls: 'out', at: ' · 11월 4일 11:20' } : refused ? { chip: '서명 거절', cls: 'out', at: ' · 11월 5일 10:40' } : (expired ? { chip: '서명 안 함', cls: 'out', at: '' } : S);
    const cliSt = canceled ? { chip: '취소함', cls: 'out', at: ' · 11월 5일 09:30' } : expired ? { chip: '서명 안 함', cls: 'out', at: '' } : (refused ? { chip: '대기 중', cls: 'out', at: '' } : C);
    return {
      isClient: isClient, isSupplier: !isClient, broke: broke, cancelM: cancelM,
      brokeWhy: canceled ? '임시 계약을 취소했습니다' : refused ? '공급자가 서명을 거절했습니다' : '서명 기한이 지났습니다',
      brokeText: canceled ? '11월 5일 임시 계약을 취소해 결렬되었습니다. 최준호님에게 알림이 갔습니다.' : refused ? '11월 5일 최준호님이 계약서 서명을 거절해 임시 계약이 바로 결렬되었습니다.' : '11월 10일까지 두 분의 서명이 모두 끝나지 않아 임시 계약이 결렬되었습니다.',
      chip: chip, chipCls: chipCls,
      supChip: supSt.chip, supCls: supSt.cls, supAt: supSt.at,
      cliChip: cliSt.chip, cliCls: cliSt.cls, cliAt: cliSt.at,
      canSign: !mine && !broke, waiting: mine && !both && !broke, bothSigned: both, pending: !both && !broke,
      signLabel: isClient ? (other ? '서명하고 예치하기' : '서명하기') : '서명하기',
      signHref: isClient && other ? 'Escrow-Client.dc.html' : (other ? '?state=양쪽+서명+완료' : '?state=내가+먼저+서명'),
      cancelTail: isClient ? '서명 기한 전에 임시 계약을 취소할 수 있습니다. 취소하면 결렬로 처리되고, 제안 비교에서 보류한 지원 중 다시 고르실 수 있습니다.' : '조건에 동의하지 않으면 서명을 거절하실 수 있습니다. 거절하면 바로 결렬되고 이 지원은 거절로 남습니다.',
      cancelLabel: isClient ? '임시 계약 취소' : '서명 거절',
      cancelHref: '?state=임시+계약+취소+확인',
      waitText: isClient ? '최준호님이 11월 10일까지 서명하면 계약이 체결되고 대금을 예치할 수 있습니다.' : '정민재님이 11월 10일까지 서명하면 계약이 체결됩니다. 대금이 예치되면 작업을 시작합니다.',
      doneText: isClient ? '계약이 체결되었습니다. 3일 안에 예치해 주세요(11월 7일까지) · 지나면 자동 결렬됩니다. 예치 다음 날부터 작업 기간 42일이 시작되고, 보류했던 지원은 그때 자동으로 거절됩니다.' : '계약이 체결되었습니다. 이제 채팅에서 연락처를 주고받을 수 있습니다. 의뢰인이 3일 안에(11월 7일까지) 예치하면 다음 날부터 작업 기간 42일이 시작됩니다 · 지나면 자동 결렬.'
    };
  }
}
