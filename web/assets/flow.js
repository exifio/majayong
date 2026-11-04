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
