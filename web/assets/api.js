/**
 * 프론트 공통 API 클라이언트. 같은 origin의 /api/v1만 호출한다.
 * 토큰은 localStorage에 두고, 401이면 refresh 1회 후 재시도한다.
 */
(() => {
  'use strict';

  const BASE = '/api/v1';
  const ACCESS = 'mj.accessToken';
  const REFRESH = 'mj.refreshToken';
  const USER = 'mj.user';
  const CONSENT_VERSION = 'project-disclosure-v0.1-draft';

  const read = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  };
  const remove = (key) => {
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  };

  function session() {
    let user = null;
    try { user = JSON.parse(read(USER) || 'null'); } catch { user = null; }
    return { accessToken: read(ACCESS), refreshToken: read(REFRESH), user };
  }

  function saveSession(data) {
    if (!data || typeof data.accessToken !== 'string') return;
    write(ACCESS, data.accessToken);
    if (typeof data.refreshToken === 'string') write(REFRESH, data.refreshToken);
    if (data.user) write(USER, JSON.stringify(data.user));
  }

  function clearSession() {
    for (const key of [ACCESS, REFRESH, USER]) remove(key);
  }

  async function send(path, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }

    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || '요청을 처리하지 못했습니다.');
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  }

  async function refreshSession() {
    const refreshToken = read(REFRESH);
    if (!refreshToken) throw new Error('NO_REFRESH_TOKEN');
    const data = await send('/auth/refresh', { method: 'POST', body: { refreshToken } });
    saveSession(data);
    return data;
  }

  async function request(path, options = {}) {
    const auth = options.auth !== false;
    try {
      return await send(path, { ...options, token: auth ? read(ACCESS) : undefined });
    } catch (error) {
      if (auth && error.status === 401 && read(REFRESH)) {
        await refreshSession();
        return send(path, { ...options, token: read(ACCESS) });
      }
      if (auth && error.status === 401) clearSession();
      throw error;
    }
  }

  async function login(email, password) {
    const data = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    saveSession(data);
    return data;
  }

  async function createDraft(input) {
    return request('/drafts', { method: 'POST', body: input });
  }

  async function getDraft(draftId) {
    return request(`/drafts/${encodeURIComponent(draftId)}`);
  }

  async function setBudget(draftId, hopeBudget) {
    return request(`/drafts/${encodeURIComponent(draftId)}/budget`, {
      method: 'PATCH',
      body: { hopeBudget },
    });
  }

  async function publishDraft(draftId, input) {
    return request(`/drafts/${encodeURIComponent(draftId)}/publish`, { method: 'POST', body: input });
  }

  function requireLogin(next) {
    if (read(ACCESS)) return true;
    const target = next || location.pathname + location.search;
    location.assign(`/Login?next=${encodeURIComponent(target)}`);
    return false;
  }

  window.MJ = {
    request,
    login,
    createDraft,
    getDraft,
    setBudget,
    publishDraft,
    session,
    clearSession,
    requireLogin,
    CONSENT_VERSION,
  };
})();
