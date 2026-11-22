'use strict';
/* MeetOffer Tech — 前端交互
   内容全部来自服务端 /api/posts（未认证时该接口返回 401，前端拿不到任何数据）。 */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = { data: null, cat: 'all', q: '', sort: 'hot' };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(name) {
    return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  function fmtStars(n) {
    if (n == null) return '';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function catOf(id) {
    return (state.data && state.data.categories.find((c) => c.id === id)) ||
      { name: id, icon: 'grid', accent: '#22C55E' };
  }

  /* ---------- 门禁 ---------- */
  const gate = $('#gate');
  const gateCard = $('.gate__card');
  const app = $('#app');
  const pwInput = $('#gate-password');
  const gateError = $('#gate-error');
  const submitBtn = $('#gate-submit');

  function showGate() {
    app.hidden = true;
    gate.hidden = false;
    state.data = null;
    setTimeout(() => pwInput.focus(), 30);
  }

  async function enterApp() {
    gate.hidden = true;
    app.hidden = false;
    await loadData();
  }

  $('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    gateError.hidden = true;
    submitBtn.disabled = true;
    const original = submitBtn.querySelector('span').textContent;
    submitBtn.querySelector('span').textContent = '验证中…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwInput.value }),
      });
      let j = {};
      try { j = await r.json(); } catch { /* ignore */ }
      if (!r.ok || !j.ok) throw new Error(j.error || '验证失败，请稍后重试');
      pwInput.value = '';
      await enterApp();
    } catch (err) {
      gateError.textContent = err.message;
      gateError.hidden = false;
      gateCard.classList.remove('shake');
      void gateCard.offsetWidth;
      gateCard.classList.add('shake');
      pwInput.select();
    } finally {
      submitBtn.disabled = false;
      submitBtn.querySelector('span').textContent = original;
    }
  });

  $('#gate-toggle').addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    $('#gate-toggle').innerHTML = icon(show ? 'eye-off' : 'eye');
    $('#gate-toggle').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    pwInput.focus();
  });

  $('#logout').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
    showGate();
  });

  /* ---------- 数据 ---------- */
  async function loadData() {
    try {
      const r = await fetch('/api/posts');
      if (r.status === 401) return showGate();
      if (!r.ok) throw new Error('内容载入失败');
      state.data = await r.json();
      renderAll();
    } catch (err) {
      $('#result-count').textContent = err.message + '（可运行 npm run refresh 重新生成内容）';
    }
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderStats();
    renderChips();
    renderFeatured();
    renderGrid();
  }

  function renderStats() {
    const d = state.data;
    $('#stat-total').textContent = d.total;
    $('#stat-cats').textContent = d.categories.length;
    $('#stat-updated').textContent = fmtDate(d.generatedAt) || '—';
    $('#footer-updated').textContent = '内容更新于 ' + (fmtDate(d.generatedAt) || '—');
  }

  function renderChips() {
    const d = state.data;
    const items = [{ id: 'all', name: '全部', icon: 'grid', count: d.total }].concat(
      d.categories.map((c) => ({ ...c, count: d.posts.filter((p) => p.category === c.id).length }))
    );
    $('#chips').innerHTML = items.map((c) => `
      <button type="button" class="chip ${state.cat === c.id ? 'is-active' : ''}" data-cat="${esc(c.id)}"
              aria-pressed="${state.cat === c.id}">
        ${icon(c.icon)}<span>${esc(c.name)}</span><span class="chip__count">${c.count}</span>
      </button>`).join('');

    $$('#chips .chip').forEach((btn) => btn.addEventListener('click', () => {
      state.cat = btn.dataset.cat;
      renderChips();
      renderGrid();
    }));
  }

  function renderFeatured() {
    const list = state.data.posts.filter((p) => p.featured).slice(0, 6);
    $('#featured-grid').innerHTML = list.map((p) => {
      const c = catOf(p.category);
      return `
      <a class="bento__item" style="--cat-color:${esc(c.accent)}" href="${esc(p.url)}"
         target="_blank" rel="noopener noreferrer">
        <div class="bento__top">
          <span class="bento__cat">${icon(c.icon)} ${esc(c.name)}</span>
          ${p.stars != null ? `<span class="bento__stars">${icon('star')}${fmtStars(p.stars)}</span>` : ''}
        </div>
        <div>
          <h3 class="bento__title">${esc(p.title)}</h3>
          <p class="bento__desc">${esc(p.note || p.description || '')}</p>
        </div>
        <div class="bento__foot">
          <span class="bento__source">${esc(p.sourceLabel || p.source)}</span>
          <span class="bento__link">查看原文 ${icon('external')}</span>
        </div>
      </a>`;
    }).join('');
  }

  function filtered() {
    let list = state.data.posts.slice();
    if (state.cat !== 'all') list = list.filter((p) => p.category === state.cat);
    if (state.q) {
      const q = state.q;
      list = list.filter((p) => [
        p.title, p.fullName, p.description, p.note, p.source, p.language,
        (p.tags || []).join(' '), catOf(p.category).name,
      ].join(' ').toLowerCase().includes(q));
    }
    if (state.sort === 'hot') {
      list.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.title.localeCompare(b.title));
    } else if (state.sort === 'new') {
      list.sort((a, b) => (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)) || a.title.localeCompare(b.title));
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    }
    return list;
  }

  function cardHtml(p) {
    const c = catOf(p.category);
    const tags = (p.tags || []).slice(0, 3)
      .map((t) => `<span class="tag">${esc(t)}</span>`).join('');
    const source = [p.source, p.fullName, fmtDate(p.updatedAt)].filter(Boolean).join(' · ');
    return `
      <article class="card" style="--cat-color:${esc(c.accent)}">
        <div class="card__top">
          <span class="card__kind">${icon(c.icon)} ${esc(c.name)}</span>
          ${p.stars != null
            ? `<span class="card__stars">${icon('star')}${fmtStars(p.stars)}</span>`
            : `<span class="card__stars">${icon('book')} 文档</span>`}
        </div>
        <h3 class="card__title">
          <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>
        </h3>
        <p class="card__desc">${esc(p.note || p.description || '')}</p>
        ${tags ? `<div class="card__tags">${tags}</div>` : ''}
        <div class="card__foot">
          <span class="card__source" title="${esc(source)}">${esc(source)}</span>
          <a class="card__go" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">查看 ${icon('external')}</a>
        </div>
      </article>`;
  }

  function renderGrid() {
    const list = filtered();
    $('#grid').innerHTML = list.map(cardHtml).join('');
    $('#empty').hidden = list.length > 0;

    const parts = ['共 ' + list.length + ' 条'];
    if (state.cat !== 'all') parts.push('分类：' + catOf(state.cat).name);
    if (state.q) parts.push('关键词：「' + state.q + '」');
    $('#result-count').textContent = parts.join(' · ');
  }

  /* ---------- 交互 ---------- */
  const search = $('#search');
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = search.value.trim().toLowerCase();
      renderGrid();
    }, 120);
  });

  $$('.sort__btn').forEach((btn) => btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    $$('.sort__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderGrid();
  }));

  $('#reset').addEventListener('click', () => {
    state.cat = 'all';
    state.q = '';
    state.sort = 'hot';
    search.value = '';
    $$('.sort__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.sort === 'hot'));
    renderChips();
    renderGrid();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !app.hidden) {
      e.preventDefault();
      search.focus();
    }
    if (e.key === 'Escape' && document.activeElement === search) {
      search.value = '';
      state.q = '';
      renderGrid();
      search.blur();
    }
  });

  /* ---------- 启动 ---------- */
  (async function boot() {
    try {
      const r = await fetch('/api/session');
      const j = await r.json();
      if (j.authenticated) return await enterApp();
    } catch { /* 服务未就绪时显示门禁 */ }
    showGate();
  })();
})();
