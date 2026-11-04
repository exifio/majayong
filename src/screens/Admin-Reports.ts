import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 신고 처리 */
export default class AdminReportsScreen extends Screen {
  static override readonly id = "Admin-Reports";
  static override readonly title = "운영자 — 신고 처리";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["처리 대기", "조치 작성", "문제 없음 선택", "채팅 7일 제한 선택", "계정 정지 선택", "처리 완료", "처리 완료 — 문제 없음", "처리 완료 — 채팅 7일 제한", "처리 완료 — 계정 정지"], "default": "처리 대기", "section": "상태"}};


  renderVals(): Values {
    const v = (this.props.view ?? '처리 대기') as string;
    // 조치 작성 = 경고를 고른 상태. '○○ 선택'은 다른 조치를 고른 상태, '처리 완료 — ○○'는 그 조치를 확정한 뒤
    const PK: Record<string, number> = { '조치 작성': 1, '문제 없음 선택': 0, '채팅 7일 제한 선택': 2, '계정 정지 선택': 3,
      '처리 완료': 1, '처리 완료 — 문제 없음': 0, '처리 완료 — 채팅 7일 제한': 2, '처리 완료 — 계정 정지': 3 };
    const done = /^처리 완료/.test(v), write = !done && v !== '처리 대기', ban = PK[v] === 3;
    const sel = done ? 1 : (write ? 1 : 0);
    const A = [
      ['문제 없음', '신고를 닫습니다', '신고를 닫고 양쪽에 따로 알리지 않습니다. 신고자에게만 \'검토 완료\'를 알립니다.'],
      ['경고', '규칙 안내와 함께 경고', '강태오님에게 경고와 연락처 규칙 안내를 보냅니다. 경고가 2회 쌓이면 채팅 제한을 검토합니다. 지원과 채팅은 그대로입니다.'],
      ['채팅 7일 제한', '7일 동안 새 메시지 금지', '7일 동안 모든 채팅이 읽기 전용입니다(진행 중인 계약 포함). 기한이 지나면 자동으로 풀리고, 지원은 그대로 남습니다.'],
      ['계정 정지', '로그인 불가 · 프로필 숨김', '로그인할 수 없고 공개 프로필이 숨겨집니다. 진행 중인 계약은 운영자가 따로 취소 정산합니다.']
    ];
    const pick = PK[v] ?? -1;
    const SHORT = ['문제 없음', '경고', '채팅 7일 제한', '계정 정지'];
    const DONE = [
      { t: '신고를 닫았습니다 · 문제 없음 · 11월 3일 10:12 · 운영자 김하늘', p: '강태오님에게는 따로 알리지 않았습니다. 신고한 오후 세시에는 \'검토 완료\'만 알립니다.' },
      { t: '경고를 보냈습니다 · 11월 3일 10:12 · 운영자 김하늘', p: '강태오님에게 경고와 연락처 규칙 안내가 갔습니다. 신고한 오후 세시에는 \'검토 완료\'만 알립니다.' },
      { t: '채팅을 7일 제한했습니다 · 11월 10일 10:12까지 · 운영자 김하늘', p: '강태오님은 그때까지 모든 채팅이 읽기 전용이고, 기한이 지나면 자동으로 풀립니다. 지원은 그대로 남습니다. 신고한 오후 세시에는 \'검토 완료\'만 알립니다.' },
      { t: '계정을 정지했습니다 · 11월 3일 10:12 · 운영자 김하늘', p: '강태오님은 로그인하면 정지 안내만 보고, 공개 프로필은 숨겨졌습니다. 진행 중인 계약은 없습니다(있으면 운영자가 취소 정산합니다). 신고한 오후 세시에는 \'검토 완료\'만 알립니다.' }
    ];
    // 사유 예시. ex=true는 캔버스에서 '(○○를 고른 경우의 예시)'로 표시만 했던 것 — 작성 중에는 빈 칸으로 둡니다.
    const WHY: { text: string; ex: boolean }[] = [
      { text: '자동 탐지 2회는 모두 가려져 실제 연락처 교환은 없었고, 신고 뒤 같은 요청이 없었습니다.', ex: true },
      { text: '15:31 메시지에서 플랫폼 밖 연락(카톡)과 수수료 회피를 제안했습니다. 계약 체결 전 연락처 교환 금지 규칙 위반, 첫 위반이라 경고합니다.', ex: false },
      { text: '15:31 메시지에서 외부 거래와 수수료 회피를 제안했고, 연락처 형식을 2회 보냈습니다. 같은 요청이 이어질 수 있어 7일 제한합니다.', ex: true },
      { text: '15:31 메시지의 외부 거래 · 수수료 회피 제안과 연락처 형식 2회 전송을 근거로 계정을 정지합니다.', ex: true }
    ];
    // 조치를 고르면 그 조치를 고른 상태로, 확정하면 그 조치의 '처리 완료' 상태로 갑니다.
    const SEL = ['문제 없음 선택', '조치 작성', '채팅 7일 제한 선택', '계정 정지 선택'];
    const FIN = ['처리 완료 — 문제 없음', '처리 완료', '처리 완료 — 채팅 7일 제한', '처리 완료 — 계정 정지'];
    const q = (view: string) => '?view=' + view.replace(/ /g, '+');
    const acts = A.map((a, i) => ({ name: a[0], desc: a[1], cls: i === pick ? 'on' : '', chk: i === pick ? 'checked' : '',
      href: done ? undefined : q(SEL[i]!) }));
    const items = [
      { reason: '연락처 · 외부 거래 유도', rCls: 'chip amber', status: done ? '처리 완료 · ' + SHORT[pick] : '처리 대기', sCls: done ? 'chip teal' : 'chip',
        title: '음료 사전 주문, 픽업 알림 외 1개 기능', who: '의뢰인 오후 세시 → 공급자 강태오', when: '11월 2일 15:40 · 자동 탐지 2회' },
      { reason: '욕설 · 비방', rCls: 'chip', status: '처리 대기', sCls: 'chip',
        title: '수조 현황판, 포장 주문 외 1개 기능', who: '공급자 윤재하 → 의뢰인 바다 횟집', when: '11월 3일 09:05' }
    ].map((it, i) => Object.assign(it, { cls: 'rp-li' + (i === 0 ? ' first sel' : ''), href: done && i === 0 ? q(v) : q('처리 대기') }));
    const nWait = done ? 1 : 2;
    return {
      items: items, acts: acts, tabCls: { wait: done ? '' : 'on', done: done ? 'on' : '' }, nWait: nWait, nDone: done ? 6 : 5, isDone: done,
      moreNote: done ? '처리 완료 6건은 \'처리 완료\' 탭에 있습니다' : '처리 완료 5건은 \'처리 완료\' 탭에 있습니다',
      dn: done ? DONE[pick] : {},
      dChip: done ? '처리 완료 · ' + SHORT[pick] : '처리 대기', dChipCls: done ? 'chip teal' : 'chip',
      prev: pick < 0 ? '조치를 고르면 무엇이 바뀌는지 여기에 보입니다.' : A[pick][2],
      why: pick < 0 || (!done && WHY[pick]!.ex) ? '' : WHY[pick]!.text,
      showBtn: write, showOff: !write && !done,
      btnCls: pick === 3 ? 'btn warn' : 'btn',
      confirmHref: pick < 0 ? undefined : q(FIN[pick]!)
    };
  }
}
