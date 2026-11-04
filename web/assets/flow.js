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
