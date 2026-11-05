/**
 * 로그인 → 초안 생성 → 명세 확정 최소 동선.
 * 디자인 화면은 그대로 두고, 각 화면의 버튼/입력에만 동작을 연결한다.
 */
(() => {
  'use strict';

  const MJ = window.MJ;
  if (!MJ) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const screen = document.body.dataset.screen || '';
  const ERR_STYLE = 'margin:12px 0;padding:12px 14px;border:1px solid #f2e0be;border-radius:10px;background:#fff8e8;color:#7a5a1c;font-size:14px;line-height:1.6';
  const SIGNUP_KEY = 'mj.pendingSignup';

  function readPendingSignup() {
    try { return JSON.parse(sessionStorage.getItem(SIGNUP_KEY) || 'null'); } catch { return null; }
  }

  function clearPendingSignup() {
    try { sessionStorage.removeItem(SIGNUP_KEY); } catch { /* ignore */ }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function won(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? `${value.toLocaleString('ko-KR')}원`
      : '미정';
  }

  function industryLabel(code) {
    if (code === 'RESTAURANT_RESERVATION') return '음식점';
    if (!code) return '기타';
    return String(code);
  }

  function formatDeadline(iso) {
    if (!iso) return '마감일 미정';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '마감일 미정';
    return `마감 ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(date)}`;
  }

  function conditionText(conditions) {
    if (!Array.isArray(conditions)) return '';
    return conditions
      .map((condition) => (typeof condition === 'string'
        ? condition
        : (condition && typeof condition === 'object' && 'text' in condition ? String(condition.text ?? '') : '')))
      .filter(Boolean)
      .join(' · ');
  }

  function escapedCareer(profile) {
    return profile?.careerYears === null || profile?.careerYears === undefined
      ? ''
      : `경력 ${profile.careerYears}년 · `;
  }

  function escapedRating(profile) {
    return profile?.ratingAvg === null || profile?.ratingAvg === undefined
      ? '평점 없음 · '
      : `★ ${profile.ratingAvg} · 리뷰 ${profile.reviewCount ?? 0}건 · `;
  }

  function replaceAllText(from, to) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.nodeValue?.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to);
    }
  }

  function kstDate(iso, withYear = false) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      ...(withYear ? { year: 'numeric' } : {}),
      month: 'long', day: 'numeric',
    }).format(date);
  }

  async function activeContract(contractId) {
    if (contractId) return MJ.request(`/contracts/${encodeURIComponent(contractId)}`);
    const rows = await MJ.request('/me/contracts');
    const list = Array.isArray(rows) ? rows : [];
    const chosen = list.find((row) => row.status === 'ACTIVE')
      || list.find((row) => row.status === 'PENDING_CONSENT')
      || list[0];
    if (!chosen) throw new Error('진행 중인 계약이 없습니다.');
    return MJ.request(`/contracts/${encodeURIComponent(chosen.id)}`);
  }

  async function contractInstallments(contractId) {
    const data = await MJ.request(`/contracts/${encodeURIComponent(contractId)}/installments`);
    return Array.isArray(data) ? data : (Array.isArray(data?.installments) ? data.installments : []);
  }

  function stageLabel(stage) {
    return stage === 'FINAL' ? '최종' : '중간';
  }

  function installmentStatusLabel(status) {
    return ({
      PENDING: '납품 전',
      DELIVERED: '검수 대기',
      PARTIALLY_APPROVED: '일부 승인',
      REWORK_REQUESTED: '보완 요청',
      APPROVED: '지급 승인',
      RELEASED: '지급 완료',
      REFUNDED: '환불',
    })[status] || status;
  }

  function showError(anchor, message) {
    let box = $('#flow-error');
    if (!box) {
      box = document.createElement('p');
      box.id = 'flow-error';
      box.setAttribute('role', 'alert');
      box.style.cssText = ERR_STYLE;
      const parent = anchor?.parentElement || document.body;
      parent.insertBefore(box, anchor || null);
    }
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  function clearError() {
    const box = $('#flow-error');
    if (box) box.hidden = true;
  }

  function busy(element, on, label) {
    if (!element) return;
    if (on) {
      element.dataset.label = element.textContent;
      element.textContent = label;
      element.style.pointerEvents = 'none';
      element.style.opacity = '.6';
      return;
    }
    if (element.dataset.label) element.textContent = element.dataset.label;
    element.style.pointerEvents = '';
    element.style.opacity = '';
  }

  function nextPath() {
    return new URL(location.href).searchParams.get('next');
  }

  function goAfterLogin(user) {
    const next = nextPath();
    if (next) return location.assign(next);
    if (user?.role === 'SUPPLIER') return location.assign('/Home-Supplier');
    if (user?.role === 'ADMIN') return location.assign('/Admin-Blocks');
    return location.assign('/Input-Client');
  }

  function formatDate(date) {
    return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}`;
  }

  function parseDate(text) {
    const match = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/.exec(String(text).trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoKst(date, endOfDay) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${endOfDay ? '23:59:59' : '00:00:00'}+09:00`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  if (screen === 'Profile-Client') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        const profile = await MJ.request('/me/client-profile');
        const industry = profile?.industryField === 'RESTAURANT_RESERVATION' ? '예약 기반 음식점' : '기타 (직접 입력)';
        const set = (selector, value) => { const element = $(selector); if (element) element.value = value == null ? "" : value; };
        set('#p-name', profile?.name);
        set('#p-biz', profile?.businessName);
        set('#p-field', industry);
        set('#p-addr', profile?.storeAddress);
        set('#p-web', profile?.websiteUrl);
        set('#p-bio', profile?.bio);

        const save = $('#profile-save');
        const note = document.createElement('p');
        note.className = 'sec';
        note.hidden = true;
        save?.parentElement?.appendChild(note);
        save?.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          note.hidden = true;
          const businessName = String($('#p-biz')?.value || '').trim();
          if (!businessName) {
            showError(save, '상호를 입력해 주세요.');
            return;
          }
          busy(save, true, '저장하는 중…');
          try {
            await MJ.updateClientProfile({
              name: String($('#p-name')?.value || '').trim() || null,
              businessName,
              industryField: String($('#p-field')?.value || '').includes('예약') ? 'RESTAURANT_RESERVATION' : 'GENERAL',
              storeAddress: String($('#p-addr')?.value || '').trim() || null,
              websiteUrl: String($('#p-web')?.value || '').trim() || null,
              bio: String($('#p-bio')?.value || '').trim() || null,
            });
            busy(save, false);
            note.textContent = '저장했습니다.';
            note.hidden = false;
          } catch (error) {
            busy(save, false);
            showError(save, error.message);
          }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Profile-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        const profile = await MJ.request('/me/supplier-profile');
        const set = (selector, value) => { const element = $(selector); if (element) element.value = value == null ? "" : value; };
        set('#s-name', profile?.displayName || profile?.name);
        set('#s-career', profile?.careerYears);
        set('#s-bio', profile?.bio);
        const industry = (profile?.industryCodes || []).includes('RESTAURANT_RESERVATION') ? '예약 기반 음식점' : '기타 (직접 입력)';
        set('#s-ind', industry);
        document.querySelectorAll('.tag').forEach((tag) => {
          const name = tag.textContent?.trim() || '';
          tag.classList.toggle('on', (profile?.skills || []).includes(name));
        });
        const links = (Array.isArray(profile?.portfolioItems) ? profile.portfolioItems : [])
          .filter((item) => item && item.type === 'LINK' && typeof item.url === 'string')
          .map((item) => item.url);
        const linkInputs = [...document.querySelectorAll('input[type="url"]')];
        linkInputs.forEach((input, index) => { input.value = links[index] || ''; });

        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-portfolio';
        host.style.marginBottom = '16px';
        const status = profile?.portfolioSummaryStatus || '없음';
        host.innerHTML = `<h2 class="ct">포트폴리오 요약</h2>
          <p class="sec">상태 ${escapeHtml(status)}${profile?.portfolioSummary ? ` · ${escapeHtml(profile.portfolioSummary.slice(0, 120))}` : ''}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn sm gh" id="portfolio-regenerate">요약 다시 만들기</button>
            ${status === 'DRAFT' ? '<button type="button" class="btn sm tint" id="portfolio-publish">요약 공개</button>' : ''}
            ${status === 'PUBLISHED' ? '<button type="button" class="btn sm gh" id="portfolio-hide">요약 숨김</button>' : ''}
          </div>`;
        const anchor = document.querySelector('main .wrap')?.firstElementChild;
        if (anchor) anchor.parentElement?.insertBefore(host, anchor.nextSibling);
        else document.querySelector('main')?.prepend(host);

        const save = $('#profile-save');
        save?.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          const displayName = String($('#s-name')?.value || '').trim();
          if (!displayName) {
            showError(save, '이름을 입력해 주세요.');
            return;
          }
          const career = Number($('#s-career')?.value);
          const skills = [...document.querySelectorAll('.tag.on')].map((tag) => tag.textContent?.trim()).filter(Boolean);
          const portfolioItems = linkInputs
            .map((input) => input.value.trim())
            .filter(Boolean)
            .map((url) => ({ type: 'LINK', url }));
          busy(save, true, '저장하는 중…');
          try {
            await MJ.updateSupplierProfile({
              name: displayName,
              displayName,
              bio: String($('#s-bio')?.value || '').trim() || null,
              industryCodes: String($('#s-ind')?.value || '').includes('예약') ? ['RESTAURANT_RESERVATION'] : ['GENERAL'],
              skills,
              ...(Number.isInteger(career) ? { careerYears: career } : {}),
              portfolioItems,
            });
            location.reload();
          } catch (error) {
            busy(save, false);
            showError(save, error.message);
          }
        });

        const regenerate = host.querySelector('#portfolio-regenerate');
        regenerate?.addEventListener('click', async (event) => {
          event.preventDefault();
          busy(regenerate, true, '만드는 중…');
          try {
            await MJ.request('/me/portfolio-summary/regenerate', { method: 'POST', body: {} });
            location.reload();
          } catch (error) {
            busy(regenerate, false);
            showError(regenerate, error.message);
          }
        });
        host.querySelector('#portfolio-publish')?.addEventListener('click', async (event) => {
          event.preventDefault();
          try { await MJ.request('/me/portfolio-summary/publish', { method: 'POST', body: {} }); location.reload(); }
          catch (error) { showError(event.currentTarget, error.message); }
        });
        host.querySelector('#portfolio-hide')?.addEventListener('click', async (event) => {
          event.preventDefault();
          try { await MJ.request('/me/portfolio-summary/hide', { method: 'POST', body: {} }); location.reload(); }
          catch (error) { showError(event.currentTarget, error.message); }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'PublicSupplier') {
    const supplierId = new URLSearchParams(location.search).get('supplierId');
    if (!supplierId) return;

    void (async () => {
      try {
        const [profile, reviews] = await Promise.all([
          MJ.request(`/profiles/suppliers/${encodeURIComponent(supplierId)}`),
          MJ.request(`/profiles/suppliers/${encodeURIComponent(supplierId)}/reviews`).catch(() => []),
        ]);
        const main = document.querySelector('main.pp') || document.querySelector('main');
        if (!main) return;
        const links = (profile.portfolioItems || []).filter((item) => item.type === 'LINK');
        const reviewList = Array.isArray(reviews) ? reviews : [];
        main.innerHTML = `<div class="wrap">
          <section class="card" style="margin:24px 0">
            <h1 class="t">${escapeHtml(profile.displayName || profile.name || '공급자')}</h1>
            <p class="sub">${profile.careerYears != null ? `경력 ${profile.careerYears}년 · ` : ''}${profile.ratingAvg != null ? `★ ${profile.ratingAvg} · 리뷰 ${profile.reviewCount}건` : '리뷰 없음'}</p>
            <p class="sec">${escapeHtml(profile.bio || '')}</p>
            <p class="sec">업종 ${escapeHtml((profile.industryCodes || []).join(', ') || '미정')} · 기술 ${escapeHtml((profile.skills || []).join(', ') || '미정')}</p>
          </section>
          <section class="card" style="margin:24px 0">
            <h2 class="ct">포트폴리오</h2>
            ${profile.portfolioSummary ? `<p class="sec">${escapeHtml(profile.portfolioSummary)}</p>` : '<p class="sec">요약이 아직 없습니다.</p>'}
            ${links.length ? `<ul>${links.map((item) => `<li><a class="ft" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || item.url)}</a></li>`).join('')}</ul>` : '<p class="sec">등록된 링크가 없습니다.</p>'}
          </section>
          <section class="card" style="margin:24px 0">
            <h2 class="ct">받은 리뷰 ${reviewList.length}건</h2>
            ${reviewList.length === 0 ? '<p class="sec">아직 리뷰가 없습니다.</p>' : reviewList.map((review) => `<div class="rcard" style="margin:12px 0"><div class="st2">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5 - Number(review.rating))} <em>${Number(review.rating)}점</em></div><p class="tx2">${escapeHtml(review.comment || '')}</p><div class="tg3">${(review.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>`).join('')}
          </section>
        </div>`;
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Contracts-Client' || screen === 'Contracts-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const isClient = screen === 'Contracts-Client';

    void (async () => {
      try {
        const rows = await MJ.request('/me/contracts');
        const list = Array.isArray(rows) ? rows : [];
        const label = (status) => ({
          PENDING_CONSENT: '서명 대기', ACTIVE: '진행 중', CANCEL_REQUESTED: '취소 요청 중',
          COMPLETED: '완료', CANCELLED: '취소/결렬',
        })[status] || status;
        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-contracts';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">내 계약</h2>
          ${list.length === 0 ? '<p class="note">계약이 없습니다.</p>' : list.map((contract) => {
            const items = Array.isArray(contract.items) ? contract.items : [];
            const title = `${items[0]?.title || '계약'}${items.length > 1 ? ` 외 ${items.length - 1}개` : ''}`;
            const actions = [
              `<a class="btn sm gh" href="/Contract-${isClient ? 'Client' : 'Supplier'}?contractId=${encodeURIComponent(contract.id)}">계약서</a>`,
              isClient && contract.status === 'ACTIVE' && (contract.paymentStatus === 'DEPOSITED' || contract.paymentStatus === 'PARTIALLY_RELEASED')
                ? `<a class="btn sm gh" href="/Cancel-Client?contractId=${encodeURIComponent(contract.id)}">취소 요청</a>` : '',
              !isClient && contract.status === 'ACTIVE' && contract.paymentStatus === 'DEPOSITED'
                ? `<a class="btn sm tint" href="/Deliver-Supplier?contractId=${encodeURIComponent(contract.id)}">납품하기</a>` : '',
              contract.status === 'COMPLETED'
                ? `<a class="btn sm tint" href="/Review-${isClient ? 'Client' : 'Supplier'}?contractId=${encodeURIComponent(contract.id)}">리뷰 쓰기</a>` : '',
              isClient && (contract.status === 'ACTIVE' || contract.status === 'CANNOT')
                ? `<a class="btn sm gh" href="/Settle-Client?contractId=${encodeURIComponent(contract.id)}">정산</a>` : '',
            ].filter(Boolean).join('');
            return `<article class="ck" style="margin:12px 0">
              <div class="bd">
                <div class="hd"><span class="chip ${contract.status === 'COMPLETED' ? 'teal' : contract.status === 'CANCELLED' ? 'out' : 'amber'}">${escapeHtml(label(contract.status))}</span><span class="dd">${escapeHtml(contract.paymentStatus)}</span></div>
                <div class="row1"><div><h3 class="ti">${escapeHtml(title)}</h3>
                  <p class="mt">합의 ${won(Number(contract.agreedAmount))} · ${Number(contract.durationDays)}일 · 예치 ${won(Number(contract.totalDeposited || 0))}</p></div>
                  <div class="amt"><div class="k">합의 금액</div><div class="v">${won(Number(contract.agreedAmount))}</div></div></div>
                <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${actions}</div>
              </div>
            </article>`;
          }).join('')}`;
        const head = document.querySelector('.head');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        document.querySelectorAll('article.ck, .gx, .cnt').forEach((element) => { element.style.display = 'none'; });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Apps-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        const rows = await MJ.request('/me/applications');
        const list = Array.isArray(rows) ? rows : [];
        const label = (status) => ({
          SUBMITTED: '검토 중', STALE: '재견적 필요', ACCEPTED: '선택됨',
          REJECTED: '거절됨', AUTO_REJECTED: '자동 거절', WITHDRAWN: '철회됨', SUPERSEDED: '대체됨',
        })[status] || status;
        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-apps';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">내 지원</h2>
          ${list.length === 0 ? '<p class="note">지원한 프로젝트가 없습니다.</p>' : list.map((application) => `<div class="pj" style="margin:12px 0">
            <div class="lt"><div class="top"><span class="chip ${application.status === 'ACCEPTED' ? 'teal' : application.status === 'STALE' ? 'amber' : 'blue'}">${escapeHtml(label(application.status))}</span><span class="mt">${kstDate(application.submittedAt)} 지원</span></div>
              <div class="ti">프로젝트 ${escapeHtml(String(application.projectId).slice(0, 8))}</div>
              <div class="mt">${won(Number(application.totalAmount))} · ${Number(application.durationDays)}일</div>
              ${application.message ? `<p class="nt">${escapeHtml(application.message)}</p>` : ''}</div>
            <div class="rt">${application.status === 'ACCEPTED' ? '<a class="btn sm tint" href="/Contracts-Supplier">계약 보기</a>' : ''}
              <a class="btn sm gh" href="/Project-Supplier?projectId=${encodeURIComponent(application.projectId)}">프로젝트 보기</a></div>
          </div>`).join('')}`;
        const head = document.querySelector('.head');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        document.querySelectorAll('.lst, .grp2, .tabs, .tabrow, .tabs2').forEach((element) => { element.style.display = 'none'; });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Notify-Client' || screen === 'Notify-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const isClient = screen === 'Notify-Client';

    void (async () => {
      try {
        const rows = await MJ.request('/me/notifications');
        const list = Array.isArray(rows) ? rows : [];
        const label = (type) => ({
          APPLICATION_RECEIVED: '지원이 도착했습니다', APPLICATION_ACCEPTED: '지원이 선택되었습니다',
          APPLICATION_AUTO_REJECTED: '지원이 자동 거절되었습니다', APPLICATION_REJECTED: '지원이 거절되었습니다',
          PROJECT_CLOSED: '프로젝트 모집이 마감되었습니다', REQUOTE_REQUESTED: '재견적이 요청되었습니다',
          NEW_MESSAGE: '새 메시지가 도착했습니다', CONTRACT_BROKEN: '계약이 결렬되었습니다',
          DEPOSIT_DUE: '예치 기한이 다가옵니다', INSPECTION_DUE: '검수 기한이 다가옵니다',
          WORK_DUE: '작업 마감이 다가옵니다', WORK_OVERDUE: '작업 마감이 지났습니다',
          AUTO_APPROVED: '검수 기한이 지나 자동 승인되었습니다', REPORT_REVIEWED: '신고가 처리되었습니다',
          INQUIRY_ANSWERED: '1:1 문의 답변이 도착했습니다',
        })[type] || type;
        const hrefFor = (notification) => {
          const id = encodeURIComponent(notification.targetId);
          switch (notification.type) {
            case 'APPLICATION_RECEIVED': return `/Compare-Client?projectId=${id}`;
            case 'APPLICATION_ACCEPTED': return `/Contract-${isClient ? 'Client' : 'Supplier'}?contractId=${id}`;
            case 'APPLICATION_AUTO_REJECTED':
            case 'APPLICATION_REJECTED':
            case 'REQUOTE_REQUESTED': return isClient ? `/Compare-Client?projectId=${id}` : `/Apps-Supplier`;
            case 'PROJECT_CLOSED': return `/Spec-Client?projectId=${id}`;
            case 'NEW_MESSAGE': return isClient ? `/Compare-Client?projectId=${id.split('%3A')[0]}` : '/Apps-Supplier';
            case 'CONTRACT_BROKEN': return `/Contract-${isClient ? 'Client' : 'Supplier'}?contractId=${id}`;
            case 'DEPOSIT_DUE': return `/Escrow-Client?contractId=${id}`;
            case 'INSPECTION_DUE': return `/Inspect-Client?contractId=${id}`;
            case 'WORK_DUE':
            case 'WORK_OVERDUE': return `/Deliver-Supplier?contractId=${id}`;
            case 'AUTO_APPROVED': return `/Settle-Client?contractId=${id}`;
            case 'INQUIRY_ANSWERED': return '/Help-Inquiry';
            default: return null;
          }
        };
        const dropdown = document.querySelector('.dd');
        if (!dropdown) return;
        dropdown.innerHTML = `<div class="hd"><b>알림 <span class="n3">${list.filter((row) => !row.isRead).length}</span></b>
          <button type="button" class="allread" id="live-read-all">모두 읽음</button></div>
          <div class="scr" id="nt-list">
            ${list.length === 0 ? '<p class="day">알림이 없습니다</p>' : list.map((notification) => `<a class="nr${notification.isRead ? '' : ' un'}" href="${hrefFor(notification) || '#'}" data-notification="${notification.id}">
              <span><span class="msg" style="display:block">${escapeHtml(label(notification.type))}</span>
              <span class="sb" style="display:block">${escapeHtml(String(notification.targetId).slice(0, 8))} · ${kstDate(notification.createdAt)}</span></span>
              <span class="rt"><span class="tm">${notification.isRead ? '' : '새 알림'}</span></span>
            </a>`).join('')}
          </div>`;
        dropdown.querySelectorAll('[data-notification]').forEach((link) => {
          link.addEventListener('click', async (event) => {
            event.preventDefault();
            const id = link.dataset.notification;
            const href = link.getAttribute('href');
            try { await MJ.request(`/me/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: {} }); } catch { /* ignore */ }
            if (href && href !== '#') location.assign(href);
          });
        });
        dropdown.querySelector('#live-read-all')?.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            await MJ.request('/me/notifications/read-all', { method: 'POST', body: {} });
            location.reload();
          } catch (error) {
            showError(event.currentTarget, error.message);
          }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Admin-Disputes') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const user = MJ.session().user;
    if (user?.role !== 'ADMIN') {
      showError(document.body, '운영자만 이견을 판정할 수 있습니다.');
      return;
    }

    void (async () => {
      try {
        const [cancellations, inspections] = await Promise.all([
          MJ.request('/admin/contracts/cancellation-queue'),
          MJ.request('/admin/inspection-requests/escalated'),
        ]);
        const cancelList = Array.isArray(cancellations) ? cancellations : [];
        const inspectionList = Array.isArray(inspections) ? inspections : [];
        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-admin-disputes';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">이견 판정</h2>
          <p class="sec">취소 ${cancelList.length}건 · 검수 이견 ${inspectionList.length}건</p>
          <h3 style="margin-top:16px">취소 판정</h3>
          ${cancelList.length === 0 ? '<p class="note">대기 중인 취소 건이 없습니다.</p>' : cancelList.map((row) => `<div class="fc" data-cancel-contract="${row.id}" style="margin:12px 0">
            <div class="nmrow"><span class="nm">${escapeHtml(row.id.slice(0, 8))}</span><span class="chip amber">${escapeHtml(row.cancelCause || '')}</span></div>
            <p class="sec">상태 ${escapeHtml(row.status)} · 예치 ${won(Number(row.totalDeposited || 0))} · 합의 ${won(Number(row.agreedAmount || 0))} · 이의 비율 ${row.objectionRate ?? '-'}%</p>
            <label class="lbl">판정 보상 비율</label>
            <input class="inp" data-cancel-rate type="number" min="0" max="100" value="${row.objectionRate ?? 50}">
            <label class="lbl" style="margin-top:8px">판정 사유</label>
            <textarea class="inp" data-cancel-reason placeholder="판정 근거를 적어 주세요"></textarea>
            <button type="button" class="btn" data-cancel-decide style="margin-top:8px">판정 보내기</button>
          </div>`).join('')}
          <h3 style="margin-top:20px">검수 이견 판정</h3>
          ${inspectionList.length === 0 ? '<p class="note">대기 중인 검수 이견이 없습니다.</p>' : inspectionList.map((row) => `<div class="fc" data-inspection="${row.id}" style="margin:12px 0">
            <div class="nmrow"><span class="nm">${escapeHtml(row.id.slice(0, 8))}</span><span class="chip amber">${escapeHtml(row.status)}</span></div>
            <p class="sec">${escapeHtml(row.reason || '')}</p>
            <label class="lbl">판정</label>
            <select class="inp" data-inspection-decision>
              <option value="REWORK_VALID">보완이 맞다</option>
              <option value="APPROVE">승인이 맞다</option>
              <option value="UNDECIDED_CONDITION">정하지 않은 조건이다</option>
            </select>
            <label class="lbl" style="margin-top:8px">판정 사유</label>
            <textarea class="inp" data-inspection-reason></textarea>
            <button type="button" class="btn" data-inspection-decide style="margin-top:8px">판정 보내기</button>
          </div>`).join('')}`;
        const main = document.querySelector('.ad-main');
        main?.insertBefore(host, main.querySelector('.ad-split') || null);
        document.querySelector('.ad-split')?.style.setProperty('display', 'none');

        host.querySelectorAll('[data-cancel-decide]').forEach((button) => {
          button.addEventListener('click', async (event) => {
            event.preventDefault();
            const card = button.closest('[data-cancel-contract]');
            const contractId = card?.dataset.cancelContract;
            const rate = Number(card?.querySelector('[data-cancel-rate]')?.value);
            const reason = card?.querySelector('[data-cancel-reason]')?.value.trim() || '';
            if (!reason) {
              showError(button, '판정 사유를 적어 주세요.');
              return;
            }
            busy(button, true, '판정 중…');
            try {
              await MJ.request(`/admin/contracts/${encodeURIComponent(contractId)}/cancellation/decide`, {
                method: 'POST',
                body: { compensationRate: rate, reason },
              });
              location.reload();
            } catch (error) {
              busy(button, false);
              showError(button, error.message);
            }
          });
        });

        host.querySelectorAll('[data-inspection-decide]').forEach((button) => {
          button.addEventListener('click', async (event) => {
            event.preventDefault();
            const card = button.closest('[data-inspection]');
            const inspectionId = card?.dataset.inspection;
            const decision = card?.querySelector('[data-inspection-decision]')?.value;
            const reason = card?.querySelector('[data-inspection-reason]')?.value.trim() || '';
            if (!reason) {
              showError(button, '판정 사유를 적어 주세요.');
              return;
            }
            busy(button, true, '판정 중…');
            try {
              await MJ.request(`/admin/inspection-requests/${encodeURIComponent(inspectionId)}/decision`, {
                method: 'POST',
                body: { decision, reason },
              });
              location.reload();
            } catch (error) {
              busy(button, false);
              showError(button, error.message);
            }
          });
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Cancel-Client' || screen === 'Cancel-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const isClient = screen === 'Cancel-Client';
    const params = new URLSearchParams(location.search);

    void (async () => {
      try {
        let contract = null;
        if (params.get('contractId')) {
          contract = await MJ.request(`/contracts/${encodeURIComponent(params.get('contractId'))}`);
        } else {
          const rows = await MJ.request('/me/contracts');
          const list = Array.isArray(rows) ? rows : [];
          contract = list.find((row) => row.status === 'CANCEL_REQUESTED')
            || list.find((row) => row.status === 'ACTIVE' && (row.paymentStatus === 'DEPOSITED' || row.paymentStatus === 'PARTIALLY_RELEASED'));
        }
        if (!contract) throw new Error('취소할 진행 계약이 없습니다.');
        const cancellation = await MJ.request(`/contracts/${encodeURIComponent(contract.id)}/cancellation`);
        const requested = Boolean(cancellation.cancelRequestedAt);
        const causeLabel = cancellation.cancelCause === 'SUPPLIER' ? '공급자 사정' : cancellation.cancelCause === 'MUTUAL' ? '서로 합의' : '의뢰인 사정';
        const canRespond = !isClient
          && cancellation.cancelRequestedBy !== MJ.session().user?.id
          && !cancellation.cancelResolvedAt
          && !cancellation.cancelEscalatedAt;

        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-cancel';
        host.style.marginBottom = '16px';
        host.innerHTML = requested
          ? `<h2 class="ct">취소 요청 현황</h2>
            <p class="sec">${escapeHtml(causeLabel)} · ${escapeHtml(cancellation.cancelNote || '')}</p>
            <p class="sec">상태 ${escapeHtml(cancellation.status)}${cancellation.cancelResolvedAt ? ` · 환불 ${won(Number(cancellation.refundAmount ?? 0))} · 보상 ${won(Number(cancellation.settledAmount ?? 0))}` : cancellation.cancelEscalatedAt ? ' · 운영자 판정 대기' : ' · 상대방 답변 대기'}</p>
            <a class="btn sm gh" href="/Settle-Client?contractId=${encodeURIComponent(contract.id)}">정산 내역 보기</a>
            ${canRespond ? `<div style="margin-top:14px">
              <label class="lbl">이의 보상 비율</label>
              <input class="inp" id="live-object-rate" type="number" min="0" max="100" value="70">
              <label class="lbl" style="margin-top:8px">이의 사유</label>
              <textarea class="inp" id="live-object-note" placeholder="이의 사유를 적어 주세요"></textarea>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button type="button" class="btn tint" id="live-agree">동의</button>
                <button type="button" class="btn warn" id="live-object">이의 제기</button>
              </div>
            </div>` : ''}`
          : `<h2 class="ct">계약 취소 요청</h2>
            <p class="sec">예치 완료 계약입니다. 취소 사유와 설명을 적어 주세요.</p>
            <label class="lbl" style="margin-top:12px">취소 사유</label>
            <select class="inp" id="live-cancel-cause">
              <option value="CLIENT">의뢰인 사정</option>
              <option value="MUTUAL">서로 합의</option>
            </select>
            <label class="lbl" style="margin-top:8px">합의 보상 비율(서로 합의 선택 시)</label>
            <input class="inp" id="live-cancel-rate" type="number" min="0" max="100" value="50">
            <label class="lbl" style="margin-top:8px">사유 설명</label>
            <textarea class="inp" id="live-cancel-note" placeholder="취소 사유를 적어 주세요"></textarea>
            <button type="button" class="btn warn" id="live-cancel-submit" style="margin-top:10px">취소 요청 보내기</button>`;
        const head = document.querySelector('.head');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        document.querySelector('.lay')?.style.setProperty('display', 'none');

        if (requested) {
          if (canRespond) {
            const agree = host.querySelector('#live-agree');
            agree?.addEventListener('click', async (event) => {
              event.preventDefault();
              busy(agree, true, '동의하는 중…');
              try {
                await MJ.request(`/contracts/${encodeURIComponent(contract.id)}/cancellation/agree`, { method: 'POST', body: {} });
                location.reload();
              } catch (error) {
                busy(agree, false);
                showError(agree, error.message);
              }
            });
            const object = host.querySelector('#live-object');
            object?.addEventListener('click', async (event) => {
              event.preventDefault();
              clearError();
              const note = host.querySelector('#live-object-note')?.value.trim() || '';
              const rate = Number(host.querySelector('#live-object-rate')?.value);
              if (!note) {
                showError(object, '이의 사유를 적어 주세요.');
                return;
              }
              if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
                showError(object, '보상 비율은 0~100 사이의 정수여야 합니다.');
                return;
              }
              busy(object, true, '이의를 보내는 중…');
              try {
                await MJ.request(`/contracts/${encodeURIComponent(contract.id)}/cancellation/object`, {
                  method: 'POST',
                  body: { objectionRate: rate, note },
                });
                location.reload();
              } catch (error) {
                busy(object, false);
                showError(object, error.message);
              }
            });
          }
          return;
        }

        const submit = host.querySelector('#live-cancel-submit');
        submit?.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          const cause = host.querySelector('#live-cancel-cause')?.value || 'CLIENT';
          const note = host.querySelector('#live-cancel-note')?.value.trim() || '';
          const rate = Number(host.querySelector('#live-cancel-rate')?.value);
          if (!note) {
            showError(submit, '사유 설명을 적어 주세요.');
            return;
          }
          busy(submit, true, '요청하는 중…');
          try {
            await MJ.request(`/contracts/${encodeURIComponent(contract.id)}/cancellation`, {
              method: 'POST',
              body: {
                cause,
                note,
                ...(cause === 'MUTUAL' ? { proposedCompensationRate: Number.isInteger(rate) ? rate : 50 } : {}),
              },
            });
            location.reload();
          } catch (error) {
            busy(submit, false);
            showError(submit, error.message);
          }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Review-Client' || screen === 'Review-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const isClient = screen === 'Review-Client';
    const params = new URLSearchParams(location.search);

    void (async () => {
      try {
        let contract = null;
        if (params.get('contractId')) {
          contract = await MJ.request(`/contracts/${encodeURIComponent(params.get('contractId'))}`);
        } else {
          const rows = await MJ.request('/me/contracts');
          contract = (Array.isArray(rows) ? rows : []).find((row) => row.status === 'COMPLETED');
        }
        if (!contract) throw new Error('완료된 계약이 없습니다.');
        if (contract.status !== 'COMPLETED') throw new Error('완료된 계약만 리뷰를 작성할 수 있습니다.');

        const reviews = await MJ.request(`/contracts/${encodeURIComponent(contract.id)}/reviews`);
        const list = Array.isArray(reviews) ? reviews : [];
        const role = isClient ? 'CLIENT' : 'SUPPLIER';
        const mine = list.find((review) => review.reviewerRole === role);
        const theirs = list.find((review) => review.reviewerRole !== role);
        const counterpart = isClient
          ? await MJ.request(`/profiles/suppliers/${encodeURIComponent(contract.supplierId)}`).catch(() => null)
          : await MJ.request(`/projects/${encodeURIComponent(contract.projectId)}/client-profile`).catch(() => null);
        const name = counterpart?.displayName || counterpart?.businessName || counterpart?.name || (isClient ? '공급자' : '의뢰인');
        const tags = isClient
          ? ['일정을 지켰어요', '설명이 쉬웠어요', '조건대로 만들었어요', '보완 요청에 빨리 답했어요', '다시 맡기고 싶어요']
          : ['조건을 분명히 정해 줬어요', '검수가 빨랐어요', '답장이 빨랐어요', '요청 범위를 지켰어요', '다시 일하고 싶어요'];

        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-review';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">${isClient ? '공급자 평가하기' : '의뢰인 평가하기'}</h2>
          <p class="sec">${escapeHtml(name)}님과의 계약 리뷰 · 완료된 계약</p>
          ${mine ? `
            <div class="done2" style="margin-top:14px"><b>리뷰를 제출했습니다</b><p>제출한 리뷰는 수정할 수 없습니다.</p></div>
            <div class="st2">${'★'.repeat(Number(mine.rating))}${'☆'.repeat(5 - Number(mine.rating))} <em>${Number(mine.rating)}점</em></div>
            <div class="tg3">${(mine.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            <p class="tx2">${escapeHtml(mine.comment || '')}</p>
            ${theirs ? `<p class="sh3" style="margin-top:14px">상대가 쓴 리뷰</p><div class="st2">${'★'.repeat(Number(theirs.rating))}${'☆'.repeat(5 - Number(theirs.rating))} <em>${Number(theirs.rating)}점</em></div><p class="tx2">${escapeHtml(theirs.comment || '')}</p>` : ''}
          ` : `
            <div class="blk" style="margin-top:14px"><h2>별점</h2>
              <div class="stars" id="live-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-rating="${n}" class="${n <= 5 ? 'on' : 'off'}" aria-label="${n}점">★</button>`).join('')}</div>
              <span class="lbl2" id="live-score">5점</span>
            </div>
            <div class="blk"><h2>어땠나요?</h2><div class="chips2" id="live-tags">${tags.map((tag) => `<button type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div></div>
            <div class="blk last"><h2>하고 싶은 말</h2><textarea class="inp tx" id="live-comment" maxlength="500" placeholder="좋았던 점이나 아쉬웠던 점을 적어 주세요"></textarea>
              <div class="cnt2"><span>연락처는 적어도 가려집니다</span><span id="live-count">0 / 500자</span></div></div>
            <button type="button" class="btn" id="live-review-submit">리뷰 제출</button>
          `}`;
        const head = document.querySelector('.head') || document.querySelector('main .wrap');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        document.querySelectorAll('.fm, .warn3, .acts2, .done2, .rcard, .sh3').forEach((element) => { element.style.display = 'none'; });

        if (mine) return;

        let rating = 5;
        const words = ['', '별로였어요', '아쉬웠어요', '보통이에요', '좋았어요', '아주 좋았어요'];
        const stars = [...host.querySelectorAll('#live-stars [data-rating]')];
        const score = host.querySelector('#live-score');
        stars.forEach((button) => {
          button.addEventListener('click', () => {
            rating = Number(button.dataset.rating);
            stars.forEach((star) => { star.className = Number(star.dataset.rating) <= rating ? 'on' : 'off'; });
            if (score) score.innerHTML = `${rating}점<span>${words[rating]}</span>`;
          });
        });
        host.querySelectorAll('#live-tags [data-tag]').forEach((button) => {
          button.addEventListener('click', () => {
            button.className = button.className === 'on' ? '' : 'on';
          });
        });
        const comment = host.querySelector('#live-comment');
        const count = host.querySelector('#live-count');
        comment?.addEventListener('input', () => {
          if (count) count.textContent = `${comment.value.length} / 500자`;
        });
        const submit = host.querySelector('#live-review-submit');
        submit?.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          const selectedTags = [...host.querySelectorAll('#live-tags .on')].map((button) => button.dataset.tag);
          busy(submit, true, '제출하는 중…');
          try {
            await MJ.request(`/contracts/${encodeURIComponent(contract.id)}/reviews`, {
              method: 'POST',
              body: {
                rating,
                ...(comment?.value.trim() ? { comment: comment.value.trim() } : {}),
                ...(selectedTags.length ? { tags: selectedTags } : {}),
              },
            });
            location.reload();
          } catch (error) {
            busy(submit, false);
            showError(submit, error.message);
          }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Deliver-Supplier') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const params = new URLSearchParams(location.search);

    void (async () => {
      try {
        const contract = await activeContract(params.get('contractId'));
        if (contract.status === 'COMPLETED') {
          const completed = document.createElement('section');
          completed.className = 'card';
          completed.style.marginBottom = '16px';
          completed.innerHTML = `<h2 class="ct">계약 완료</h2><p class="sec">납품과 검수가 끝난 계약입니다.</p>
            <a class="btn tint" href="/Review-Supplier?contractId=${encodeURIComponent(contract.id)}">의뢰인 리뷰 쓰기</a>`;
          const head = document.querySelector('.head');
          head?.parentElement?.insertBefore(completed, head.nextSibling);
          document.querySelector('.lay')?.style.setProperty('display', 'none');
          return;
        }
        if (contract.status !== 'ACTIVE' || contract.paymentStatus !== 'DEPOSITED') {
          throw new Error('예치가 완료된 진행 계약이 필요합니다.');
        }
        const installments = await contractInstallments(contract.id);
        const stage = params.get('stage') === 'FINAL' ? 'FINAL' : 'INTERIM';
        const installment = installments.find((row) => row.stage === stage);
        if (!installment) throw new Error('해당 구간을 찾을 수 없습니다.');

        const items = (contract.items || []).filter((item) => item.stage === stage);
        const unapproved = items.filter((item) => !item.approvedAt);
        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-delivery';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">납품 제출 · ${stageLabel(stage)}</h2>
          <p class="sec">구간 상태 ${escapeHtml(installmentStatusLabel(installment.status))} · 검수 기한 ${installment.status === 'DELIVERED' ? '7일' : '제출 후 7일'}</p>
          <div style="display:flex;gap:8px;margin:12px 0">
            <a class="btn sm ${stage === 'INTERIM' ? 'tint' : 'gh'}" href="?contractId=${encodeURIComponent(contract.id)}&stage=INTERIM">중간 구간</a>
            <a class="btn sm ${stage === 'FINAL' ? 'tint' : 'gh'}" href="?contractId=${encodeURIComponent(contract.id)}&stage=FINAL">최종 구간</a>
          </div>
          ${unapproved.length === 0
            ? '<p class="note">이 구간의 모든 항목이 승인되었습니다.</p>'
            : unapproved.map((item) => `<div class="fc" data-contract-item="${item.id}" style="margin:12px 0">
                <div class="nmrow"><span class="nm">${escapeHtml(item.title)}</span></div>
                <p class="ds">${escapeHtml(item.description)}</p>
                <p class="k">공급자와 정할 것</p>
                <div class="tg2">${(item.conditions || []).map((condition) => `<span>${escapeHtml(condition.text || condition.key)}</span>`).join('')}</div>
                <label class="lbl" style="margin-top:10px">결과물 링크</label>
                <input class="inp" data-link type="url" placeholder="https://…">
                <label class="lbl" style="margin-top:8px">확인 방법</label>
                <textarea class="inp" data-memo placeholder="어디서 무엇을 확인하면 되는지 적어 주세요"></textarea>
              </div>`).join('')}
          ${unapproved.length > 0 ? '<button type="button" class="btn" id="deliver-submit">납품 제출</button>' : ''}`;
        const head = document.querySelector('.head');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        const layout = document.querySelector('.lay');
        if (layout) layout.style.display = 'none';

        const submit = host.querySelector('#deliver-submit');
        if (submit) {
          submit.addEventListener('click', async (event) => {
            event.preventDefault();
            clearError();
            const rows = [...host.querySelectorAll('[data-contract-item]')].map((row) => {
              const link = row.querySelector('[data-link]')?.value.trim() || '';
              const memo = row.querySelector('[data-memo]')?.value.trim() || '';
              return {
                contractItemId: row.dataset.contractItem,
                links: link ? [link] : [],
                files: [],
                howToCheck: memo || '확인 방법 미기재',
              };
            });
            busy(submit, true, '제출하는 중…');
            try {
              await MJ.request(`/installments/${encodeURIComponent(installment.id)}/deliveries`, {
                method: 'POST',
                body: { items: rows },
              });
              location.reload();
            } catch (error) {
              busy(submit, false);
              showError(submit, error.message);
            }
          });
        }
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Inspect-Client') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const params = new URLSearchParams(location.search);

    void (async () => {
      try {
        const contract = await activeContract(params.get('contractId'));
        const installments = await contractInstallments(contract.id);
        const requested = params.get('stage');
        const candidates = installments.filter((row) => ['DELIVERED', 'PARTIALLY_APPROVED', 'REWORK_REQUESTED'].includes(row.status));
        const installment = (requested ? installments.find((row) => row.stage === requested) : null)
          || candidates[0]
          || installments.find((row) => row.stage === 'INTERIM');
        if (!installment) throw new Error('검수할 구간이 없습니다.');
        const deliveries = await MJ.request(`/installments/${encodeURIComponent(installment.id)}/deliveries`);
        const latest = Array.isArray(deliveries) ? deliveries.at(-1) : null;
        const stageItems = (contract.items || []).filter((item) => item.stage === installment.stage);
        const byId = new Map(stageItems.map((item) => [item.id, item]));

        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-inspect';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">검수 · ${stageLabel(installment.stage)} 구간</h2>
          <p class="sec">구간 상태 ${escapeHtml(installmentStatusLabel(installment.status))}${latest ? ` · ${kstDate(latest.submittedAt)} 납품` : ' · 아직 납품 전'}</p>
          ${latest ? latest.items.map((payload) => {
            const item = byId.get(payload.contractItemId);
            if (!item) return '';
            return `<div class="fc" data-contract-item="${item.id}" style="margin:12px 0">
              <div class="nmrow"><span class="nm">${escapeHtml(item.title)}</span>${item.approvedAt ? '<span class="chip teal">승인</span>' : '<span class="chip blue">검수 대기</span>'}</div>
              <p class="ds">${escapeHtml(item.description)}</p>
              <p class="k">공급자 납품물</p>
              <p class="sec">${(payload.links || []).map((link) => `<a class="ft" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`).join('<br>') || '링크 없음'}</p>
              <p class="sec">${escapeHtml(payload.howToCheck || '확인 방법 미기재')}</p>
              ${item.approvedAt ? '' : `<div style="display:flex;gap:8px;margin-top:10px">
                <button type="button" class="btn sm tint" data-approve>승인</button>
                <button type="button" class="btn sm gh" data-rework>보완 요청</button>
              </div>`}
            </div>`;
          }).join('') : '<p class="note">아직 납품이 없습니다.</p>'}
          ${latest && stageItems.every((item) => item.approvedAt) ? `<p class="note"><b>모든 항목 승인 완료</b> · 지급 처리는 정산 화면에서 확인할 수 있습니다.</p>
            <a class="btn sm tint" href="/Settle-Client?contractId=${encodeURIComponent(contract.id)}">정산 보기</a>` : ''}`;
        const head = document.querySelector('.head');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        const layout = document.querySelector('.lay');
        if (layout) layout.style.display = 'none';

        host.querySelectorAll('[data-approve]').forEach((button) => {
          button.addEventListener('click', async (event) => {
            event.preventDefault();
            const itemId = button.closest('[data-contract-item]')?.dataset.contractItem;
            busy(button, true, '승인 중…');
            try {
              await MJ.request(`/contract-items/${encodeURIComponent(itemId)}/approve`, {
                method: 'POST',
                body: { deliveryId: latest.id },
              });
              location.reload();
            } catch (error) {
              busy(button, false);
              showError(button, error.message);
            }
          });
        });
        host.querySelectorAll('[data-rework]').forEach((button) => {
          button.addEventListener('click', async (event) => {
            event.preventDefault();
            const itemId = button.closest('[data-contract-item]')?.dataset.contractItem;
            const note = window.prompt('보완 요청 내용을 적어 주세요.');
            if (note === null) return;
            busy(button, true, '보내는 중…');
            try {
              await MJ.request(`/contract-items/${encodeURIComponent(itemId)}/rework-requests`, {
                method: 'POST',
                body: { deliveryId: latest.id, reason: 'CONDITION_MISMATCH', note },
              });
              location.reload();
            } catch (error) {
              busy(button, false);
              showError(button, error.message);
            }
          });
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Settle-Client') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const params = new URLSearchParams(location.search);

    void (async () => {
      try {
        const contract = await activeContract(params.get('contractId'));
        const installments = (await contractInstallments(contract.id)).sort((a, b) => (a.stage === "INTERIM" ? -1 : 1));
        const total = Number(contract.totalDeposited) || (Number(contract.agreedAmount) + Number(contract.clientFee));
        const host = document.createElement('section');
        host.className = 'card';
        host.id = 'live-settle';
        host.style.marginBottom = '16px';
        host.innerHTML = `<h2 class="ct">정산 내역</h2>
          <p class="sec">계약 ${escapeHtml(contract.id.slice(0, 8))} · ${escapeHtml(contract.status)} · 예치 ${won(total)}</p>
          <div class="tl">
            <div class="tr"><span class="d">예치</span><span class="kd">예치금</span><span class="nt">${escapeHtml(contract.paymentStatus)}</span><span class="am">${won(total)}<i>합의 ${won(Number(contract.agreedAmount))} + 수수료 ${won(Number(contract.clientFee))}</i></span><span class="st"><span class="chip teal">확인</span></span></div>
            ${installments.map((row) => `<div class="tr"><span class="d">${stageLabel(row.stage)}</span><span class="kd">${stageLabel(row.stage)} 구간</span><span class="nt">${escapeHtml(installmentStatusLabel(row.status))}</span><span class="am">${won(Number(row.amount))}<i>지급액 ${won(Number(row.releaseAmount ?? row.amount))}${row.holdReason ? ` · 보류 ${escapeHtml(row.holdReason)}` : ''}</i></span><span class="st"><span class="chip ${row.status === 'RELEASED' ? 'teal' : row.status === 'APPROVED' ? 'blue' : 'out'}">${escapeHtml(installmentStatusLabel(row.status))}</span></span></div>`).join('')}
          </div>
          <p class="note" style="margin-top:12px">표시된 금액은 정산 내역이며 실제 송금은 운영자 처리 단계에서 확정됩니다.</p>
          <a class="btn sm gh" style="margin-top:10px" href="/Contract-Client?contractId=${encodeURIComponent(contract.id)}">계약서 보기</a>`;
        const head = document.querySelector('.head');
        head?.parentElement?.insertBefore(host, head.nextSibling);
        document.querySelectorAll('.smCls, .pc, .grp3').forEach((element) => { element.style.display = 'none'; });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Escrow-Client') {
    const contractId = new URLSearchParams(location.search).get('contractId');
    if (!contractId) return;
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        const [contract, deposits] = await Promise.all([
          MJ.request(`/contracts/${encodeURIComponent(contractId)}`),
          MJ.request(`/contracts/${encodeURIComponent(contractId)}/deposits`),
        ]);
        const amount = Number(contract.agreedAmount);
        const fee = Number(contract.clientFee);
        const total = amount + fee;
        replaceAllText('3,100,000', amount.toLocaleString('ko-KR'));
        replaceAllText('3,255,000', total.toLocaleString('ko-KR'));
        replaceAllText('155,000', fee.toLocaleString('ko-KR'));
        replaceAllText('42일', `${Number(contract.durationDays)}일`);

        const pay = document.querySelector('.pay');
        if (!pay) return;
        const list = Array.isArray(deposits) ? deposits : [];
        const completed = list.find((deposit) => deposit.status === 'COMPLETED');
        const pending = list.find((deposit) => deposit.status === 'PENDING' || deposit.status === 'HELD');

        if (completed) {
          pay.querySelectorAll('.cbx, a.btn').forEach((element) => element.remove());
          const banner = document.createElement('div');
          banner.className = 'rc';
          banner.style.cssText = 'margin:12px 0;padding:12px 14px;border:1px solid #cfe8dc;border-radius:10px;background:#f2fbf7';
          banner.innerHTML = `<b>예치가 완료되었습니다</b><p style="margin:6px 0 0">예치금 ${won(Number(completed.amount))} · 작업 기간 ${Number(contract.durationDays)}일</p>
            <a class="btn sm gh" style="margin-top:8px" href="/Contract-Client?contractId=${encodeURIComponent(contractId)}">계약서 보기</a>`;
          pay.appendChild(banner);
          return;
        }

        const button = pay.querySelector('a.btn');
        if (!button) return;
        button.textContent = `${won(total)} 예치하기`;
        button.removeAttribute('href');
        button.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          if (!document.querySelector('#agree1')?.checked) {
            showError(button, '계약서와 정산 규칙을 확인해 주세요.');
            return;
          }
          busy(button, true, '예치 처리 중…');
          try {
            let deposit = pending;
            if (!deposit) {
              const created = await MJ.request(`/contracts/${encodeURIComponent(contractId)}/deposits`, {
                method: 'POST',
                body: {
                  idempotencyKey: `deposit:${contractId}`,
                  method: document.querySelector('input[name="pm"]')?.checked === false ? 'BANK_TRANSFER' : 'CARD',
                  amount: total,
                },
              });
              deposit = created?.deposit;
            }
            if (!deposit?.id) throw new Error('예치 건을 만들지 못했습니다.');
            await MJ.request(`/contracts/${encodeURIComponent(contractId)}/deposits/${encodeURIComponent(deposit.id)}/sandbox-confirm`, {
              method: 'POST',
              body: {},
            });
            location.assign(`/Escrow-Client?contractId=${encodeURIComponent(contractId)}&view=${encodeURIComponent('예치 완료')}`);
          } catch (error) {
            busy(button, false);
            if (error.status === 404) {
              showError(button, 'sandbox 예치 확인이 비활성화되어 있습니다. 운영자 확인이 필요합니다.');
              return;
            }
            showError(button, error.message);
          }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Agreement-Client') {
    const applicationId = new URLSearchParams(location.search).get('applicationId');
    if (!applicationId) return;
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        const [preview, application] = await Promise.all([
          MJ.request(`/applications/${encodeURIComponent(applicationId)}/agreement-preview`),
          MJ.request(`/applications/${encodeURIComponent(applicationId)}`),
        ]);
        const items = Array.isArray(preview?.draft?.items) ? preview.draft.items : [];
        if (items.length === 0) throw new Error('합의할 명세 항목이 없습니다.');
        const amount = Number(application.totalAmount);
        const fee = Math.floor(amount * 0.05);
        const total = amount + fee;

        const sub = document.querySelector('.head .sub');
        if (sub) sub.textContent = `견적 ${won(amount)} · 작업 기간 ${Number(application.durationDays)}일`;

        const host = document.querySelector('.lay > div');
        if (host) {
          host.innerHTML = items.map((item, index) => {
            const stage = item.stage === 'INTERIM' ? '중간' : '최종';
            const conditions = (item.conditions || []).map((condition, conditionIndex) => {
              const state = condition.state || 'UNDECIDED';
              const chip = state === 'DECIDED'
                ? ['chip teal', '정해짐']
                : state === 'PROPOSED'
                  ? ['chip', '한쪽 제안']
                  : ['chip out', '아직 안 정함'];
              const note = state === 'DECIDED'
                ? '합의된 조건입니다.'
                : state === 'PROPOSED'
                  ? '한쪽 제안만 있어 계약서에 정하지 않음으로 남습니다.'
                  : '채팅에서 아직 정하지 않았습니다. 계약서에 정하지 않음으로 남습니다.';
              return `<div class="cr${conditionIndex === 0 ? ' first' : ''}">
                <div class="q">${escapeHtml(condition.text || condition.key)}</div>
                <div><div class="pend">${escapeHtml(note)}</div></div>
                <div class="st"><span class="${chip[0]}">${chip[1]}</span></div>
              </div>`;
            }).join('');
            return `<section class="fc" aria-label="${escapeHtml(item.title)}">
              <div class="fh"><div><div class="nm">${escapeHtml(item.title)}</div><div class="ds">명세 항목 ${index + 1}</div></div><span class="stg">지급 구간 <b>${stage}</b></span></div>
              ${conditions}
            </section>`;
          }).join('');
        }

        const ratio = Number(preview?.draft?.interimRatio) || 50;
        const ratioText = document.querySelector('.ratio .big');
        if (ratioText) ratioText.textContent = `중간 ${ratio} : 최종 ${100 - ratio}`;
        const split = document.querySelectorAll('.ratio .split2 .r b');
        const interimAmount = Math.floor(amount * ratio / 100);
        if (split[0]) split[0].textContent = won(interimAmount);
        if (split[1]) split[1].textContent = won(amount - interimAmount);

        const amounts = document.querySelectorAll('.dock .amts .v');
        if (amounts[0]) amounts[0].textContent = won(amount);
        if (amounts[1]) amounts[1].textContent = won(fee);
        if (amounts[2]) amounts[2].textContent = won(total);

        const back = document.querySelector('.dock .acts a.btn.gh');
        if (back) back.href = `/Chat-Client?applicationId=${encodeURIComponent(applicationId)}`;

        const confirm = document.querySelector('.dock .acts a.btn:last-child');
        if (!confirm) return;
        confirm.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          busy(confirm, true, '합의를 마치는 중…');
          try {
            const result = await MJ.request(`/applications/${encodeURIComponent(applicationId)}/agreement/confirm`, {
              method: 'POST',
              body: {},
            });
            const contractId = result?.contract?.id;
            if (!contractId) throw new Error('계약 번호를 받지 못했습니다.');
            location.assign(`/Contract-Client?contractId=${encodeURIComponent(contractId)}`);
          } catch (error) {
            busy(confirm, false);
            showError(confirm, error.message);
          }
        });
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Contract-Client') {
    const contractId = new URLSearchParams(location.search).get('contractId');
    if (!contractId) return;
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        const contract = await MJ.request(`/contracts/${encodeURIComponent(contractId)}`);
        const amount = Number(contract.agreedAmount);
        const fee = Number(contract.clientFee);
        const total = amount + fee;

        replaceAllText('3,100,000', amount.toLocaleString('ko-KR'));
        replaceAllText('3,255,000', total.toLocaleString('ko-KR'));
        replaceAllText('155,000', fee.toLocaleString('ko-KR'));
        replaceAllText('42일', `${Number(contract.durationDays)}일`);
        if (contract.consentDeadline) replaceAllText('11월 10일', kstDate(contract.consentDeadline));

        const chip = document.querySelector('.head .chip');
        if (chip) {
          if (contract.status === 'ACTIVE') {
            chip.textContent = '계약 체결';
            chip.className = 'chip teal';
          } else if (contract.status === 'CANCELLED') {
            chip.textContent = '결렬';
            chip.className = 'chip out';
          } else {
            chip.textContent = '임시 계약 · 서명 대기';
            chip.className = 'chip amber';
          }
        }

        const clientSigned = Boolean(contract.clientSignedAt);
        const signbox = document.querySelector('.signbox');
        if (signbox) {
          if (contract.status === 'COMPLETED') {
            signbox.innerHTML = `<p class="done">계약이 완료되었습니다.</p>
              <a class="btn full" href="/Review-Client?contractId=${encodeURIComponent(contractId)}">리뷰 쓰기</a>`;
          } else if (contract.status === 'ACTIVE') {
            const deposited = contract.paymentStatus !== 'PENDING';
            signbox.innerHTML = `<p class="done">${deposited ? '예치가 완료되어 작업이 진행 중입니다.' : '계약이 체결되었습니다. 3일 안에 예치해 주세요.'}</p>
              <a class="btn full" href="${deposited
                ? `/Inspect-Client?contractId=${encodeURIComponent(contractId)}`
                : `/Escrow-Client?contractId=${encodeURIComponent(contractId)}`}">${deposited ? '납품 검수하기' : `${won(total)} 예치하기`}</a>`;
          } else if (clientSigned) {
            signbox.innerHTML = '<p class="done">서명 완료. 공급자 서명을 기다리고 있습니다.</p>';
          } else {
            const button = signbox.querySelector('a.btn');
            if (button) {
              button.textContent = '서명하기';
              button.removeAttribute('href');
              button.addEventListener('click', async (event) => {
                event.preventDefault();
                clearError();
                if (!document.querySelector('#agree')?.checked) {
                  showError(button, '계약 내용을 확인하고 동의해 주세요.');
                  return;
                }
                busy(button, true, '서명하는 중…');
                try {
                  await MJ.request(`/contracts/${encodeURIComponent(contractId)}/sign`, {
                    method: 'POST',
                    body: { expectedContentHash: contract.contentHash },
                  });
                  location.reload();
                } catch (error) {
                  busy(button, false);
                  showError(button, error.message);
                }
              });
            }
          }
        }
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Compare-Client') {
    if (!MJ.requireLogin(location.pathname + location.search)) return;
    const list = document.querySelector('section.list');
    if (!list) return;

    void (async () => {
      try {
        const projects = await MJ.request('/me/projects');
        if (!Array.isArray(projects) || projects.length === 0) {
          list.innerHTML = '<div class="zero"><h2>프로젝트가 없습니다</h2><p>먼저 초안을 만들고 명세를 확정해 주세요.</p><a class="btn tint" href="/Input-Client">프로젝트 시작</a></div>';
          return;
        }
        const params = new URLSearchParams(location.search);
        let projectId = params.get('projectId');
        if (!projectId || !projects.some((project) => project.projectId === projectId)) {
          projectId = (projects.find((project) => project.applicationCount > 0) || projects[0]).projectId;
        }
        const project = projects.find((row) => row.projectId === projectId);
        const cards = await MJ.request(`/projects/${encodeURIComponent(projectId)}/applications`);

        const sub = document.querySelector('.head .sub');
        if (sub) sub.innerHTML = `<b>지원 ${cards.length}건</b> · ${escapeHtml(project?.title || '프로젝트')}`;

        let picker = document.getElementById('compare-project');
        if (!picker) {
          picker = document.createElement('select');
          picker.id = 'compare-project';
          picker.className = 'inp';
          picker.style.cssText = 'max-width:420px;margin:0 0 14px';
          list.parentElement.insertBefore(picker, list);
          picker.addEventListener('change', () => {
            location.assign(`/Compare-Client?projectId=${encodeURIComponent(picker.value)}`);
          });
        }
        picker.innerHTML = projects.map((row) => `<option value="${row.projectId}"${row.projectId === projectId ? ' selected' : ''}>${escapeHtml(row.title)} · ${Number(row.applicationCount) || 0}건</option>`).join('');

        list.innerHTML = '';
        if (!Array.isArray(cards) || cards.length === 0) {
          list.innerHTML = '<div class="zero"><h2>아직 지원이 없습니다</h2><p>공급자가 지원하면 이 화면에서 견적과 포트폴리오를 비교할 수 있습니다.</p></div>';
          return;
        }

        const profiles = await Promise.all(cards.map((card) =>
          MJ.request(`/profiles/suppliers/${encodeURIComponent(card.supplierId)}`).catch(() => null)));
        cards.forEach((card, index) => {
          const profile = profiles[index];
          const name = profile?.displayName || profile?.name || '공급자';
          const rating = profile?.ratingAvg === null || profile?.ratingAvg === undefined
            ? '평점 없음'
            : `★ ${profile.ratingAvg} · 리뷰 ${profile.reviewCount ?? 0}건`;
          const career = profile?.careerYears === null || profile?.careerYears === undefined
            ? ''
            : `경력 ${profile.careerYears}년 · `;
          const submitted = new Date(card.submittedAt);
          const fee = Math.floor(Number(card.totalAmount) * 0.05);
          const article = document.createElement('article');
          article.className = 'sc';
          article.innerHTML = `<div class="l">
            <span class="av" aria-hidden="true">${escapeHtml(name.slice(0, 1))}</span>
            <div class="bd">
              <div class="top">
                <p class="nm">${escapeHtml(name)}</p>
                ${card.questionCount ? `<span class="chip blue qchip">질문 ${Number(card.questionCount)}</span>` : ''}
              </div>
              <p class="mt">${escapeHtml(career)}${escapeHtml(rating)}<span class="sep">|</span>${Number.isNaN(submitted.getTime()) ? '' : escapeHtml(new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(submitted))} 지원</p>
              ${profile?.portfolioSummary
                ? `<div class="pf"><p class="k">포트폴리오 요약<span>AI가 등록 자료를 읽고 정리</span></p><p>${escapeHtml(profile.portfolioSummary)}</p></div>`
                : '<div class="pf none"><p class="k">포트폴리오</p><p>요약이 없습니다.</p></div>'}
              <div class="links"><a class="ft" href="/PublicSupplier?supplierId=${encodeURIComponent(card.supplierId)}">프로필 보기</a></div>
            </div>
          </div>
          <div class="r">
            <div class="amt"><p class="k">견적 금액</p><div class="v">${won(Number(card.totalAmount))}</div><div class="fx">수수료 포함 ${won(Number(card.totalAmount) + fee)}</div></div>
            <div class="acts"><a class="btn sm tint" href="/Chat-Client?applicationId=${encodeURIComponent(card.applicationId)}">문의하기 (채팅)</a></div>
          </div>`;
          list.appendChild(article);
        });
      } catch (error) {
        list.innerHTML = `<div class="zero"><h2>지원 목록을 불러오지 못했습니다</h2><p>${escapeHtml(error.message)}</p></div>`;
      }
    })();
    return;
  }

  if (screen === 'Chat-Client') {
    const applicationId = new URLSearchParams(location.search).get('applicationId');
    if (!applicationId) return;
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    void (async () => {
      try {
        await MJ.request(`/applications/${encodeURIComponent(applicationId)}/chat/open`, { method: 'POST', body: {} }).catch(() => null);
        const [application, view, projects] = await Promise.all([
          MJ.request(`/applications/${encodeURIComponent(applicationId)}`),
          MJ.request(`/applications/${encodeURIComponent(applicationId)}/messages`),
          MJ.request('/me/projects').catch(() => []),
        ]);
        const profile = await MJ.request(`/profiles/suppliers/${encodeURIComponent(application.supplierId)}`).catch(() => null);
        const me = MJ.session().user;
        const name = profile?.displayName || profile?.name || '공급자';
        const project = (Array.isArray(projects) ? projects : []).find((row) => row.projectId === application.projectId);
        const messages = Array.isArray(view?.messages) ? view.messages : [];

        const aside = document.querySelector('aside.ls');
        if (aside) {
          aside.innerHTML = `<div class="lh">채팅</div>
            <div class="pj">${escapeHtml(project?.title || '프로젝트')}</div>
            <a class="it on" href="#">
              <span class="av" aria-hidden="true">${escapeHtml(name.slice(0, 1))}</span>
              <span class="bd">
                <span class="r1"><span class="nm">${escapeHtml(name)}</span><span class="tm"></span></span>
                <span class="pv" style="display:block">${escapeHtml(messages.at(-1)?.body || '아직 메시지가 없습니다')}</span>
                <span class="r3"><span class="chip blue">문의 중</span></span>
              </span>
            </a>
            <p class="foot3">메시지는 계약 전까지 저장되며 연락처는 자동으로 가려집니다.</p>`;
        }

        const heading = document.querySelector('.cvh .who3 .nm');
        if (heading) heading.innerHTML = `${escapeHtml(name)} <span class="chip blue">문의 중</span>`;
        const meta = document.querySelector('.cvh .mt');
        if (meta) meta.innerHTML = `${escapedCareer(profile)}${escapedRating(profile)}<a class="ft" href="/Compare-Client?projectId=${encodeURIComponent(application.projectId)}">${escapeHtml(project?.title || '제안 비교')}</a>`;
        const acts = document.querySelector('.cvh .acts');
        if (acts) {
          const agreementLink = application.status === 'SUBMITTED' || application.status === 'STALE'
            ? `<a class="btn sm tint" href="/Agreement-Client?applicationId=${encodeURIComponent(applicationId)}">합의 확인·계약</a>`
            : '';
          acts.innerHTML = `<a class="btn sm gh" href="/Compare-Client?projectId=${encodeURIComponent(application.projectId)}">제안 비교로</a>${agreementLink}`;
        }

        const items = Array.isArray(application.items) ? application.items : [];
        const qbar = document.querySelector('.qbar');
        if (qbar) qbar.innerHTML = `<span>지금 견적 <b>${won(Number(application.totalAmount))}</b></span><span>작업 기간 <b>${Number(application.durationDays)}일</b></span><span>할 수 있는 항목 <b>${items.filter((item) => item.isAvailable).length} / ${items.length}</b></span>`;
        document.querySelector('.cond')?.remove();
        document.querySelector('.stl')?.remove();

        const host = document.querySelector('.msgs');
        if (host) {
          host.innerHTML = messages.length === 0
            ? '<div class="starter"><p><b style="color:var(--s900)">아직 메시지가 없습니다.</b><br>첫 메시지를 보내면 대화가 시작됩니다.</p></div>'
            : messages.map((message) => {
              if (message.kind === 'SYSTEM') return `<p class="sys">${escapeHtml(message.body)}</p>`;
              const mine = message.senderId === me?.id;
              const time = new Intl.DateTimeFormat('ko-KR', {
                timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
              }).format(new Date(message.createdAt));
              return `<div class="m${mine ? ' me' : ''}"><p class="by">${mine ? '나' : escapeHtml(name)} · ${escapeHtml(time)}</p><div class="bb">${escapeHtml(message.body)}</div></div>`;
            }).join('');
        }

        const input = document.querySelector('.in .row input');
        const button = document.querySelector('.in .row button');
        if (input && button) {
          const send = async () => {
            const body = input.value.trim();
            if (!body) return;
            busy(button, true, '보내는 중…');
            try {
              await MJ.request(`/applications/${encodeURIComponent(applicationId)}/messages`, { method: 'POST', body: { body } });
              location.reload();
            } catch (error) {
              busy(button, false);
              showError(button, error.message);
            }
          };
          button.addEventListener('click', (event) => { event.preventDefault(); void send(); });
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); void send(); }
          });
        }

        await MJ.request(`/applications/${encodeURIComponent(applicationId)}/messages/read`, { method: 'POST', body: {} }).catch(() => null);
      } catch (error) {
        showError(document.body, error.message);
      }
    })();
    return;
  }

  if (screen === 'Find-Supplier') {
    if (!MJ.requireLogin('/Find-Supplier')) return;
    const section = document.querySelector('section[aria-label="프로젝트 목록"]');
    if (!section) return;
    let list = section.querySelector('.plist');
    if (!list) {
      list = document.createElement('div');
      list.className = 'plist';
      section.insertBefore(list, section.querySelector('.foot2'));
    }
    list.innerHTML = '<p class="sec" style="padding:24px 0">프로젝트를 불러오는 중…</p>';

    MJ.request('/projects?page=1&pageSize=10')
      .then((items) => {
        list.innerHTML = '';
        const rows = Array.isArray(items) ? items : [];
        const count = section.querySelector('.cnt');
        if (count) count.textContent = `모집 프로젝트 ${rows.length}건`;
        if (rows.length === 0) {
          list.innerHTML = '<div class="empty"><h2>모집 중인 프로젝트가 없습니다</h2><p>새 프로젝트가 등록되면 여기에 표시됩니다.</p></div>';
          return;
        }
        for (const project of rows) {
          const closed = project.status !== 'RECRUITING';
          const article = document.createElement('article');
          article.className = `pc${closed ? ' closed' : ''}`;
          article.innerHTML = `<div class="l">
            <div class="top">
              <span class="chip">${escapeHtml(industryLabel(project.industryCode))}</span>
              ${closed ? '<span class="chip out">모집 마감</span>' : ''}
              <span class="dl${closed ? '' : ' soon'}">${escapeHtml(formatDeadline(project.deadline))}</span>
            </div>
            <h2 class="ti">${escapeHtml(project.title)}</h2>
            <p class="it">명세 항목 <b>${Number(project.itemCount) || 0}개</b></p>
            <div class="stk">${(project.requiredSkills || []).map((skill) => `<span class="tag">${escapeHtml(skill)}</span>`).join('')}</div>
          </div>
          <div class="r">
            <div class="bud"><p class="k">희망 예산</p><div class="v">${escapeHtml(project.hopeBudgetBand || '미정')}</div></div>
            <div class="rt2"><a class="btn sm ${closed ? 'gh' : 'tint'}" href="/Project-Supplier?projectId=${encodeURIComponent(project.projectId)}">${closed ? '명세 보기' : '명세 열어보기'}</a></div>
          </div>`;
          list.appendChild(article);
        }
        const pager = section.querySelector('.pager');
        if (pager) pager.style.display = 'none';
        const empty = section.querySelector('.empty');
        if (empty) empty.style.display = 'none';
      })
      .catch((error) => {
        list.innerHTML = `<div class="empty"><h2>프로젝트를 불러오지 못했습니다</h2><p>${escapeHtml(error.message)}</p></div>`;
        if (error.code === 'SUPPLIER_NDA_REQUIRED') {
          const link = document.createElement('a');
          link.className = 'btn tint';
          link.href = '/Signup-Supplier';
          link.textContent = '공급자 프로필·NDA 입력하기';
          list.querySelector('.empty')?.appendChild(link);
        }
      });
    return;
  }

  if (screen === 'Project-Supplier') {
    const projectId = new URL(location.href).searchParams.get('projectId');
    if (!projectId) return;
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    MJ.request(`/projects/${encodeURIComponent(projectId)}`)
      .then((project) => {
        const items = Array.isArray(project.items) ? project.items : [];
        const title = document.querySelector('h1.t');
        if (title) title.textContent = project.title;
        const sub = document.querySelector('.sub');
        if (sub) sub.textContent = `명세 항목 ${items.length}개 · ${formatDeadline(project.deadline)}`;
        const budget = document.querySelector('.budget .big');
        if (budget) budget.textContent = won(project.hopeBudget);
        const meta = document.querySelectorAll('.budget .meta div b');
        if (meta[0]) meta[0].textContent = formatDeadline(project.deadline).replace('마감 ', '');
        if (meta[1]) meta[1].textContent = `${items.length}개`;

        const host = document.querySelector('.lay > div');
        if (host) {
          host.querySelectorAll('.fc:not(.pay)').forEach((element) => element.remove());
          const pay = host.querySelector('.fc.pay');
          items.forEach((item, index) => {
            const section = document.createElement('section');
            section.className = 'fc';
            section.innerHTML = `<div class="nmrow"><span class="no">${index + 1}</span><span class="nm">${escapeHtml(item.title)}</span></div>
              <p class="ds">${escapeHtml(item.description)}</p>
              <div class="dec"><p class="k">공급자와 정할 것</p><div class="tg2">${(Array.isArray(item.conditions) ? item.conditions : [])
                .map((condition) => `<span>${escapeHtml(typeof condition === 'string' ? condition : (condition?.text || ''))}</span>`)
                .join('')}</div></div>`;
            if (pay) host.insertBefore(section, pay);
            else host.appendChild(section);
          });
          const heading = host.querySelector('.secH h2');
          if (heading) heading.textContent = `기능 ${items.length}개`;
        }

        const cta = document.querySelector('a[href*="QuoteWrite-Supplier"]');
        if (cta) {
          if (project.status === 'RECRUITING') {
            cta.href = `/QuoteWrite-Supplier?projectId=${encodeURIComponent(projectId)}`;
          } else {
            cta.removeAttribute('href');
            cta.classList.add('off');
            cta.setAttribute('aria-disabled', 'true');
            cta.textContent = '모집이 마감되었습니다';
          }
        }
      })
      .catch((error) => showError(document.body, error.message));
    return;
  }

  if (screen === 'QuoteWrite-Supplier') {
    const projectId = new URL(location.href).searchParams.get('projectId');
    if (!projectId) return;
    if (!MJ.requireLogin(location.href)) return;

    MJ.request(`/projects/${encodeURIComponent(projectId)}`)
      .then((project) => {
        const items = Array.isArray(project.items) ? project.items : [];
        const container = document.querySelector('.items');
        if (!container) return;
        container.innerHTML = '';
        items.forEach((item, index) => {
          const row = document.createElement('div');
          row.className = `ir${index === 0 ? ' first' : ''}`;
          row.dataset.specItemId = item.specItemId || '';
          row.dataset.available = 'true';
          row.innerHTML = `<div style="min-width:0">
            <div class="nm">${escapeHtml(item.title)}</div>
            <div class="ds">${escapeHtml(item.description)}</div>
            <div class="cd">공급자와 정할 것 · <b>${escapeHtml(conditionText(item.conditions))}</b></div>
          </div>
          <span class="tg2" role="group" aria-label="${escapeHtml(item.title)} 가능 여부">
            <span class="on" data-avail="true">가능</span><span data-avail="false">불가</span>
          </span>`;
          const toggles = row.querySelectorAll('[data-avail]');
          toggles.forEach((toggle) => toggle.addEventListener('click', () => {
            const available = toggle.dataset.avail === 'true';
            row.dataset.available = String(available);
            toggles[0].className = available ? 'on' : '';
            toggles[1].className = available ? '' : 'on no';
          }));
          container.appendChild(row);
        });

        const count = document.querySelector('#h-it span');
        if (count) count.textContent = `할 수 있는 항목 ${items.length} / ${items.length}`;
        const amount = $('#amt');
        if (amount && project.hopeBudget !== null && project.hopeBudget !== undefined) {
          amount.value = String(project.hopeBudget);
        }
        const days = $('#days');
        if (days && !days.value) days.value = '42';

        const submit = document.querySelector('.sumc a.btn');
        if (!submit) return;
        submit.addEventListener('click', async (event) => {
          event.preventDefault();
          clearError();
          const rows = [...container.querySelectorAll('.ir[data-spec-item-id]')]
            .map((row) => ({ specItemId: row.dataset.specItemId, isAvailable: row.dataset.available === 'true' }))
            .filter((row) => Boolean(row.specItemId));
          if (rows.length === 0 || rows.every((row) => !row.isAvailable)) {
            showError(submit, '할 수 있는 항목을 하나 이상 골라 주세요.');
            return;
          }
          const totalAmount = Number(String(amount?.value || '').replace(/[^\d]/g, ''));
          const durationDays = Number(String(days?.value || '').replace(/[^\d]/g, ''));
          if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
            showError(submit, '총액을 입력해 주세요.');
            return;
          }
          if (!Number.isInteger(durationDays) || durationDays <= 0) {
            showError(submit, '작업 기간을 입력해 주세요.');
            return;
          }
          busy(submit, true, '제출하는 중…');
          try {
            await MJ.request(`/projects/${encodeURIComponent(projectId)}/applications`, {
              method: 'POST',
              body: {
                items: rows,
                totalAmount,
                durationDays,
                ...(($('#msg')?.value.trim() || '') ? { message: $('#msg').value.trim() } : {}),
              },
            });
            location.assign('/Apps-Supplier');
          } catch (error) {
            busy(submit, false);
            showError(submit, error.message);
          }
        });
      })
      .catch((error) => showError(document.body, error.message));
    return;
  }

  if (screen === 'Signup') {
    const next = $('#signup-next');
    if (!next) return;

    next.addEventListener('click', (event) => {
      event.preventDefault();
      clearError();
      const email = $('#su-email')?.value.trim() || '';
      const password = $('#su-pw')?.value || '';
      if (!email || !password) {
        showError(next, '이메일과 비밀번호를 입력해 주세요.');
        return;
      }
      if (!$('#ag1')?.checked || !$('#ag2')?.checked) {
        showError(next, '필수 약관에 동의해 주세요.');
        return;
      }
      try {
        sessionStorage.setItem(SIGNUP_KEY, JSON.stringify({ email, password, termsVersion: 'terms-v1' }));
      } catch {
        showError(next, '브라우저 저장소를 사용할 수 없습니다.');
        return;
      }
      location.assign('/Signup-Role');
    });
    return;
  }

  if (screen === 'Signup-Role') {
    const next = $('#signup-role-next');
    if (!next) return;

    next.addEventListener('click', async (event) => {
      event.preventDefault();
      clearError();
      const pending = readPendingSignup();
      if (!pending?.email || !pending?.password) {
        location.assign('/Signup');
        return;
      }
      const role = $('#role-supplier')?.checked ? 'SUPPLIER' : 'CLIENT';
      // 이메일 가입은 Signup 화면에서 이미 동의했다. 구글 가입일 때만 이 화면에 약관이 있다.
      const commonChecks = [$('#g1'), $('#g2')].filter(Boolean);
      if (commonChecks.length > 0 && commonChecks.some((element) => !element.checked)) {
        showError(next, '필수 약관에 동의해 주세요.');
        return;
      }
      const supplierNda = $('#g3');
      if (role === 'SUPPLIER' && supplierNda && !supplierNda.checked) {
        showError(next, '공급자 비밀유지 약관에 동의해 주세요.');
        return;
      }

      busy(next, true, '계정을 만드는 중…');
      try {
        await MJ.register({ ...pending, role });
        clearPendingSignup();
        location.assign(role === 'SUPPLIER' ? '/Signup-Supplier' : '/Signup-Client');
      } catch (error) {
        busy(next, false);
        showError(next, error.code === 'EMAIL_ALREADY_REGISTERED'
          ? '이미 가입된 이메일입니다. 로그인해 주세요.'
          : error.message);
      }
    });
    return;
  }

  if (screen === 'Signup-Client') {
    const save = $('#profile-save');
    const skip = $('#profile-skip');
    if (!MJ.session().accessToken) {
      location.assign(`/Login?next=${encodeURIComponent('/Signup-Client')}`);
      return;
    }

    const industryField = () =>
      ($('#c-field')?.value || '').includes('예약') ? 'RESTAURANT_RESERVATION' : 'GENERAL';

    save?.addEventListener('click', async (event) => {
      event.preventDefault();
      clearError();
      const businessName = $('#c-biz')?.value.trim() || '';
      if (!businessName) {
        showError(save, '상호를 입력해 주세요.');
        return;
      }
      busy(save, true, '저장하는 중…');
      try {
        await MJ.updateClientProfile({
          ...(($('#c-name')?.value.trim() || '') ? { name: $('#c-name').value.trim() } : {}),
          businessName,
          industryField: industryField(),
          ...(($('#c-addr')?.value.trim() || '') ? { storeAddress: $('#c-addr').value.trim() } : {}),
          ...(($('#c-web')?.value.trim() || '') ? { websiteUrl: $('#c-web').value.trim() } : {}),
          ...(($('#c-bio')?.value.trim() || '') ? { bio: $('#c-bio').value.trim() } : {}),
        });
        location.assign(nextPath() || '/Home-Client');
      } catch (error) {
        busy(save, false);
        showError(save, error.message);
      }
    });
    skip?.addEventListener('click', (event) => {
      event.preventDefault();
      location.assign(nextPath() || '/Home-Client');
    });
    return;
  }

  if (screen === 'Signup-Supplier') {
    const save = $('#profile-save');
    const skip = $('#profile-skip');
    if (!MJ.session().accessToken) {
      location.assign(`/Login?next=${encodeURIComponent('/Signup-Supplier')}`);
      return;
    }

    save?.addEventListener('click', async (event) => {
      event.preventDefault();
      clearError();
      const displayName = $('#s-name')?.value.trim() || '';
      if (!displayName) {
        showError(save, '이름을 입력해 주세요.');
        return;
      }
      if (!$('#nda')?.checked || !$('#fee')?.checked) {
        showError(save, '필수 동의 항목을 확인해 주세요.');
        return;
      }
      const skills = [...document.querySelectorAll('.tag.on')]
        .map((element) => element.textContent?.trim())
        .filter((value) => Boolean(value));
      const careerValue = $('#s-career')?.value;
      const careerYears = careerValue === '' ? undefined : Number(careerValue);

      busy(save, true, '저장하는 중…');
      try {
        await MJ.updateSupplierProfile({
          name: displayName,
          displayName,
          ...(($('#s-bio')?.value.trim() || '') ? { bio: $('#s-bio').value.trim() } : {}),
          industryCodes: ['RESTAURANT_RESERVATION'],
          ...(skills.length ? { skills } : {}),
          ...(Number.isInteger(careerYears) ? { careerYears } : {}),
          ndaConsent: true,
        });
        location.assign(nextPath() || '/Home-Supplier');
      } catch (error) {
        busy(save, false);
        showError(save, error.message);
      }
    });
    skip?.addEventListener('click', (event) => {
      event.preventDefault();
      location.assign(nextPath() || '/Home-Supplier');
    });
    return;
  }

  if (screen === 'Login') {
    const submit = $('#login-submit');
    const email = $('#li-email');
    const password = $('#li-pw');
    if (!submit || !email || !password) return;

    submit.addEventListener('click', async (event) => {
      event.preventDefault();
      clearError();
      if (!email.value.trim() || !password.value) {
        showError(submit, '이메일과 비밀번호를 입력해 주세요.');
        return;
      }
      busy(submit, true, '로그인 중…');
      try {
        const data = await MJ.login(email.value.trim(), password.value);
        goAfterLogin(data.user);
      } catch (error) {
        busy(submit, false);
        showError(submit, error.message);
      }
    });
    return;
  }

  if (screen === 'Input-Client') {
    const pain = $('#pain');
    const start = $('[data-flow="create-draft"]');
    const preset = $('[data-flow="default-draft"]');

    async function create(entryType, text, anchor) {
      if (!MJ.requireLogin(location.pathname)) return;
      clearError();
      if (entryType === 'SENTENCE' && !text) {
        showError(anchor, '불편한 점을 한 문장으로 적어 주세요.');
        pain?.focus();
        return;
      }
      busy(anchor, true, entryType === 'SENTENCE' ? '초안을 만드는 중…' : '기본 구성을 불러오는 중…');
      try {
        const draft = await MJ.createDraft(
          entryType === 'SENTENCE' ? { entryType, text } : { entryType: 'DEFAULT_DRAFT' },
        );
        const rawBudget = String($('#bud')?.value || '').replace(/[^\d]/g, '');
        const budget = Number(rawBudget);
        if (Number.isSafeInteger(budget) && budget > 0) {
          await MJ.setBudget(draft.id, budget);
        }
        location.assign(`/Draft-Client?draftId=${encodeURIComponent(draft.id)}`);
      } catch (error) {
        busy(anchor, false);
        showError(anchor, error.message);
      }
    }

    start?.addEventListener('click', (event) => {
      event.preventDefault();
      void create('SENTENCE', pain?.value.trim() || '', start);
    });
    preset?.addEventListener('click', (event) => {
      event.preventDefault();
      void create('DEFAULT_DRAFT', '', preset);
    });
    return;
  }

  if (screen === 'Draft-Client') {
    const draftId = new URL(location.href).searchParams.get('draftId');
    if (!draftId) return;
    if (!MJ.requireLogin(location.pathname + location.search)) return;

    const confirm = $('[data-flow="confirm"]');
    confirm?.addEventListener('click', (event) => {
      event.preventDefault();
      location.assign(`/Confirm-Client?draftId=${encodeURIComponent(draftId)}`);
    });

    MJ.getDraft(draftId)
      .then((draft) => {
        const head = $('.head') || $('h1') || document.body;
        const pending = Array.isArray(draft.pendingFeatures) ? draft.pendingFeatures : [];
        const blocks = Array.isArray(draft.blocks) ? draft.blocks : [];
        const banner = document.createElement('div');
        banner.className = 'note';
        banner.style.cssText = 'margin:16px 0;padding:14px 16px;border:1px solid #d7e5ff;border-radius:10px;background:#f5f9ff;font-size:14px;line-height:1.6';
        banner.innerHTML = `<b>${draft.status || '초안'}</b><p style="margin:4px 0 0">기능 ${blocks.length}개${pending.length ? ` · 만드는 중 ${pending.length}개` : ''}</p>`;
        if (pending.length) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'btn sm tint';
          retry.textContent = '다시 시도';
          retry.style.marginTop = '8px';
          retry.addEventListener('click', async () => {
            busy(retry, true, '다시 만드는 중…');
            try {
              await MJ.request(`/drafts/${encodeURIComponent(draftId)}/retry`, { method: 'POST' });
              location.reload();
            } catch (error) {
              busy(retry, false);
              showError(retry, error.message);
            }
          });
          banner.appendChild(retry);
        }
        head.parentElement?.insertBefore(banner, head.nextSibling);
      })
      .catch((error) => showError($('.head') || document.body, error.message));
    return;
  }

  if (screen === 'Spec-Client') {
    const projectId = new URL(location.href).searchParams.get('projectId');
    if (!projectId || !MJ.session().accessToken) return;

    MJ.request('/me/projects')
      .then((projects) => {
        const project = (Array.isArray(projects) ? projects : []).find((row) => row.projectId === projectId);
        if (!project) return;
        const title = document.querySelector('h1');
        if (title && project.title) title.textContent = project.title;
        if (project.deadline) {
          const deadline = new Intl.DateTimeFormat('ko-KR', {
            timeZone: 'Asia/Seoul', month: 'long', day: 'numeric',
          }).format(new Date(project.deadline));
          for (const element of document.querySelectorAll('.stband p, .chip.amber')) {
            if (element.textContent && element.textContent.includes('마감')) {
              element.innerHTML = element.innerHTML.replace(/마감\s+[^·<]+/, `마감 ${deadline} `);
            }
          }
        }
      })
      .catch(() => { /* 화면은 정적 상태로 둔다 */ });
    return;
  }

  if (screen === 'Confirm-Client') {    const draftId = new URL(location.href).searchParams.get('draftId');
    if (!draftId) return;
    if (!MJ.requireLogin(location.href)) return;

    const startInput = $('#rs');
    const deadlineInput = $('#rd');
    const today = new Date();
    if (startInput) startInput.value = formatDate(today);
    if (deadlineInput) deadlineInput.value = formatDate(addDays(today, 7));

    const submit = $('[data-flow="publish"]');
    submit?.addEventListener('click', async (event) => {
      event.preventDefault();
      clearError();

      const agree = $('#agree');
      if (agree && !agree.checked) {
        showError(submit, '공개 범위에 동의해 주세요.');
        return;
      }
      const recruitStartAt = parseDate(startInput?.value || '');
      const deadline = parseDate(deadlineInput?.value || '');
      if (!recruitStartAt || !deadline || recruitStartAt >= deadline) {
        showError(submit, '모집 시작일은 마감일보다 앞이어야 합니다.');
        return;
      }

      busy(submit, true, '확정하는 중…');
      try {
        const project = await MJ.publishDraft(draftId, {
          recruitStartAt: isoKst(recruitStartAt, false),
          deadline: isoKst(deadline, true),
          disclosureConsentVersion: MJ.CONSENT_VERSION,
          disclosureScope: 'FULL',
          disclosureConsent: true,
        });
        location.assign(`/Spec-Client?projectId=${encodeURIComponent(project.projectId)}&view=${encodeURIComponent('모집 시작됨')}`);
      } catch (error) {
        busy(submit, false);
        if (error.code === 'CLIENT_PROFILE_INCOMPLETE') {
          showError(submit, '가게 정보(상호)를 먼저 입력해 주세요. 프로필 화면으로 이동합니다.');
          setTimeout(() => {
            location.assign(`/Profile-Client?next=${encodeURIComponent(location.pathname + location.search)}`);
          }, 1200);
          return;
        }
        showError(submit, error.message);
      }
    });
  }
})();
