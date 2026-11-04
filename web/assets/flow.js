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
          if (contract.status === 'ACTIVE') {
            signbox.innerHTML = `<p class="done">계약이 체결되었습니다. 3일 안에 예치해 주세요.</p>
              <a class="btn full" href="/Escrow-Client?contractId=${encodeURIComponent(contractId)}">${won(total)} 예치하기</a>`;
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
