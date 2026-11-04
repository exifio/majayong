import { Screen, type PropSpecs, type Values } from '../lib/screen.js';

/** 운영자 — 신고 처리 */
export default class AdminReportsScreen extends Screen {
  static override readonly id = "Admin-Reports";
  static override readonly title = "운영자 — 신고 처리";
  static override readonly sharedStyles = true;
  static override readonly props: PropSpecs = {"view": {"editor": "enum", "options": ["처리 대기", "조치 작성", "처리 완료", "계정 정지 선택"], "default": "처리 대기", "section": "상태"}};


  renderVals(): Values {
    const v = this.props.view ?? '처리 대기';
    const ban = v === '계정 정지 선택', write = v === '조치 작성' || ban, done = v === '처리 완료';
    const sel = done ? 1 : (write ? 1 : 0);
    const A = [
      ['문제 없음', '신고를 닫습니다', '신고를 닫고 양쪽에 따로 알리지 않습니다. 신고자에게만 \'검토 완료\'를 알립니다.'],
      ['경고', '규칙 안내와 함께 경고', '강태오님에게 경고와 연락처 규칙 안내를 보냅니다. 경고가 2회 쌓이면 채팅 제한을 검토합니다. 지원과 채팅은 그대로입니다.'],
      ['채팅 7일 제한', '7일 동안 새 메시지 금지', '7일 동안 새 메시지를 보낼 수 없습니다. 진행 중인 계약의 채팅은 읽기만 되고, 지원은 그대로 남습니다.'],
      ['계정 정지', '로그인 불가 · 프로필 숨김', '로그인할 수 없고 공개 프로필이 숨겨집니다. 진행 중인 계약은 운영자가 따로 취소 정산합니다.']
    ];
    const pick = ban ? 3 : ((write || done) ? 1 : -1);
    const acts = A.map((a, i) => ({ name: a[0], desc: a[1], cls: i === pick ? 'on' : '', chk: i === pick ? 'checked' : '' }));
    const items = [
      { reason: '연락처 · 외부 거래 유도', rCls: 'chip amber', status: done ? '처리 완료 · 경고' : '처리 대기', sCls: done ? 'chip teal' : 'chip',
        title: '음료 사전 주문, 픽업 알림 외 1개 기능', who: '의뢰인 오후 세시 → 공급자 강태오', when: '11월 2일 15:40 · 자동 탐지 2회' },
      { reason: '욕설 · 비방', rCls: 'chip', status: '처리 대기', sCls: 'chip',
        title: '수조 현황판, 포장 주문 외 1개 기능', who: '공급자 윤재하 → 의뢰인 바다 횟집', when: '11월 3일 09:05' }
    ].map((it, i) => Object.assign(it, { cls: 'rp-li' + (i === 0 ? ' first sel' : '') }));
    const nWait = done ? 1 : 2;
    return {
      items: items, acts: acts, nWait: nWait, nDone: done ? 6 : 5, isDone: done,
      moreNote: done ? '처리 완료 6건은 \'처리 완료\' 탭에 있습니다' : '처리 완료 5건은 \'처리 완료\' 탭에 있습니다',
      dChip: done ? '처리 완료 · 경고' : '처리 대기', dChipCls: done ? 'chip teal' : 'chip',
      prev: pick < 0 ? '조치를 고르면 무엇이 바뀌는지 여기에 보입니다.' : A[pick][2],
      why: ban ? '15:31 메시지의 외부 거래 · 수수료 회피 제안과 연락처 형식 2회 전송을 근거로 계정을 정지합니다. (정지를 고른 경우의 예시)' : (write || done) ? '15:31 메시지에서 플랫폼 밖 연락(카톡)과 수수료 회피를 제안했습니다. 계약 체결 전 연락처 교환 금지 규칙 위반, 첫 위반이라 경고합니다.' : '',
      showBtn: write, showOff: !write && !done,
      btnCls: pick === 3 ? 'btn warn' : 'btn'
    };
  }
}
