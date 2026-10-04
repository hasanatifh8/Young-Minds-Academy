// Exam Vault — public paper browser.
// Data comes from Supabase when assets/vault-config.js is filled in, otherwise from data/sample-papers.json.
(function () {
  const CFG = window.YMA_VAULT_CONFIG || {};
  const TAX = window.YMA_TAXONOMY;
  const PAGE_SIZE = 12;
  const LEAD_KEY = 'yma_vault_lead';

  const configured = CFG.supabaseUrl && !CFG.supabaseUrl.startsWith('YOUR_') &&
    CFG.supabaseAnonKey && !CFG.supabaseAnonKey.startsWith('YOUR_');
  const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const icons = () => window.lucide && lucide.createIcons();

  const CATEGORY = Object.fromEntries(TAX.categories.map((c) => [c.value, c]));
  const BOARD_LABEL = Object.fromEntries(TAX.boards.map((b) => [b.value, b.label]));
  const CLASS_LABEL = Object.fromEntries(TAX.classes.map((c) => [c.value, c.label]));

  const BADGE_STYLE = {
    PYQ_OFFICIAL: 'bg-indigo-100 text-indigo-700',
    GUESS_PAPER: 'bg-amber-100 text-amber-800',
    SAMPLE_PAPER: 'bg-green-100 text-green-700',
    PRE_BOARD_MASTERS: 'bg-purple-100 text-purple-700',
    CHAPTERWISE_PYQ: 'bg-blue-100 text-blue-700',
  };

  let papers = [];
  let shown = PAGE_SIZE;
  const state = { q: '', type: '', board: [], cls: [], subject: '', year: [], sol: false, sort: 'latest' };

  // ---------- Data access ----------
  async function loadPapers() {
    if (sb) {
      // Row Level Security only returns published papers (or scheduled ones whose time has come).
      const { data, error } = await sb.from('question_papers').select('*');
      if (error) throw error;
      return data;
    }
    const res = await fetch('data/sample-papers.json');
    return res.json();
  }

  function fileUrl(path, downloadName) {
    if (!path) return null;
    if (sb) return sb.storage.from(CFG.bucket || 'papers').getPublicUrl(path, downloadName ? { download: downloadName } : undefined).data.publicUrl;
    return path;
  }

  async function recordDownload(paper) {
    paper.download_count = (paper.download_count || 0) + 1;
    if (sb) {
      const { data } = await sb.rpc('increment_download', { paper_id: paper.id });
      if (typeof data === 'number') paper.download_count = data;
    }
    render(false);
  }

  async function saveLead(paper, phone, name) {
    if (sb) {
      const { error } = await sb.from('paper_leads').insert({
        paper_id: paper.id, whatsapp: phone, student_name: name || null, class_grade: paper.class_grade,
      });
      if (error) throw error;
    }
    try { localStorage.setItem(LEAD_KEY, phone); } catch (e) { /* storage unavailable */ }
  }

  async function isUnlocked() {
    try { if (localStorage.getItem(LEAD_KEY)) return true; } catch (e) { /* ignore */ }
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data && data.session) return true;
    }
    return false;
  }

  // ---------- URL sync ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const list = (k) => (p.get(k) ? p.get(k).split(',').filter(Boolean) : []);
    state.q = p.get('q') || '';
    state.type = p.get('type') || '';
    state.board = list('board').map((b) => b.toUpperCase());
    state.cls = list('class').map(Number);
    state.subject = p.get('subject') || '';
    state.year = list('year').map(Number);
    state.sol = p.get('solutions') === '1';
    state.sort = ['latest', 'downloads', 'recommended'].includes(p.get('sort')) ? p.get('sort') : 'latest';
    return p.get('paper');
  }

  function writeUrl(paperId) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.board.length) p.set('board', state.board.join(','));
    if (state.cls.length) p.set('class', state.cls.join(','));
    if (state.type) p.set('type', state.type);
    if (state.subject) p.set('subject', state.subject);
    if (state.year.length) p.set('year', state.year.join(','));
    if (state.sol) p.set('solutions', '1');
    if (state.sort !== 'latest') p.set('sort', state.sort);
    if (paperId) p.set('paper', paperId);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  function paperLink(paper) {
    return `${location.origin}${location.pathname}?paper=${encodeURIComponent(paper.id)}`;
  }

  // ---------- Filtering ----------
  function haystack(p) {
    return [p.title, p.subject, p.exam_year, (p.tags || []).join(' '), p.paper_set, p.region,
      BOARD_LABEL[p.board], CLASS_LABEL[p.class_grade], CATEGORY[p.category]?.label].join(' ').toLowerCase();
  }

  function hasSolution(p) {
    return p.solution_type !== 'NONE' || !!p.solution_pdf_path || !!p.solution_video_url;
  }

  function filtered() {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = papers.filter((p) =>
      (!state.type || p.category === state.type) &&
      (!state.board.length || state.board.includes(p.board)) &&
      (!state.cls.length || state.cls.includes(p.class_grade)) &&
      (!state.subject || slug(p.subject) === state.subject) &&
      (!state.year.length || state.year.includes(p.exam_year)) &&
      (!state.sol || hasSolution(p)) &&
      terms.every((t) => p._hay.includes(t)));

    const by = {
      latest: (a, b) => b.exam_year - a.exam_year || String(b.created_at).localeCompare(String(a.created_at)),
      downloads: (a, b) => b.download_count - a.download_count,
      recommended: (a, b) => (b.is_recommended - a.is_recommended) || b.download_count - a.download_count,
    }[state.sort];
    // Featured papers are always pinned to the top.
    return list.sort((a, b) => (b.is_featured - a.is_featured) || by(a, b));
  }

  // ---------- Rendering ----------
  function badgeText(p) {
    const board = BOARD_LABEL[p.board];
    switch (p.category) {
      case 'PYQ_OFFICIAL': return `${board} ${p.exam_year} Official${p.paper_set ? ' · ' + p.paper_set.replace(/\s*\(.*\)/, '') : ''}`;
      case 'GUESS_PAPER': return `Guess Paper ${p.exam_year}`;
      case 'SAMPLE_PAPER': return `Sample Paper ${p.exam_year} + MS`;
      case 'PRE_BOARD_MASTERS': return `Pre-Board ${p.exam_year}`;
      default: return `Chapter-wise PYQ${p.paper_set ? ' · ' + p.paper_set : ''}`;
    }
  }

  function badge(p) {
    return `<span class="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${BADGE_STYLE[p.category] || 'bg-slate-100 text-slate-700'}">${esc(badgeText(p))}</span>`;
  }

  function solutionNote(p) {
    if (p.solution_type === 'SEPARATE_SOLUTION_PDF' || p.solution_pdf_path) return ['Solution PDF available', 'text-green-700'];
    if (p.solution_type === 'INCLUDED_IN_MAIN_PDF') return ['Solutions included in PDF', 'text-green-700'];
    if (p.solution_video_url) return ['Video solution available', 'text-green-700'];
    return ['Question paper only', 'text-slate-400'];
  }

  function card(p) {
    const [solText, solClass] = solutionNote(p);
    const tags = (p.tags || []).slice(0, 3).map((t) => `<span class="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded">${esc(t)}</span>`).join('');
    return `
      <article class="bg-white rounded-2xl border border-gray-100 shadow-soft p-5 flex flex-col hover:shadow-lg transition-shadow" data-id="${esc(p.id)}">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          ${badge(p)}
          ${p.is_featured ? '<span class="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><i data-lucide="star" class="w-3.5 h-3.5 fill-amber-400 text-amber-500"></i> Featured</span>' : ''}
          ${p.is_lead_gated ? '<span class="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><i data-lucide="lock" class="w-3.5 h-3.5"></i> Exclusive</span>' : ''}
        </div>
        <h3 class="font-heading font-semibold text-slate-900 leading-snug mb-3">${esc(p.title)}</h3>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 mb-3">
          <span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3.5 h-3.5"></i>${esc(p.exam_year)}</span>
          <span class="flex items-center gap-1"><i data-lucide="book-open" class="w-3.5 h-3.5"></i>${esc(p.subject)}</span>
          ${p.file_size_mb ? `<span class="flex items-center gap-1"><i data-lucide="file" class="w-3.5 h-3.5"></i>${Number(p.file_size_mb).toFixed(1)} MB</span>` : ''}
          <span class="flex items-center gap-1"><i data-lucide="download" class="w-3.5 h-3.5"></i>${Number(p.download_count || 0).toLocaleString('en-IN')} downloads</span>
        </div>
        ${tags ? `<div class="flex flex-wrap gap-1.5 mb-3">${tags}</div>` : ''}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium mb-4">
          ${p.category === 'GUESS_PAPER' ? '<span class="flex items-center gap-1 text-indigo-700"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Curated by Senior Faculty Panel</span>' : ''}
          <span class="flex items-center gap-1 ${solClass}"><i data-lucide="${solClass.includes('green') ? 'check-circle' : 'file-question'}" class="w-3.5 h-3.5"></i> ${solText}</span>
        </div>
        <div class="mt-auto flex flex-wrap items-center gap-2">
          <button type="button" data-action="preview" class="inline-flex items-center gap-1.5 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-lg px-3 py-2 text-sm font-semibold transition-colors">
            <i data-lucide="eye" class="w-4 h-4"></i> Preview</button>
          <button type="button" data-action="download" class="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-2 text-sm font-semibold transition-colors">
            <i data-lucide="download" class="w-4 h-4"></i> Paper</button>
          ${p.solution_pdf_path ? `<button type="button" data-action="solution" class="inline-flex items-center gap-1.5 border border-green-200 text-green-700 hover:bg-green-50 rounded-lg px-3 py-2 text-sm font-semibold transition-colors">
            <i data-lucide="file-check-2" class="w-4 h-4"></i> Solution</button>` : ''}
          ${p.solution_video_url ? `<a href="${esc(p.solution_video_url)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-lg px-3 py-2 text-sm font-semibold transition-colors">
            <i data-lucide="play-circle" class="w-4 h-4"></i> Video</a>` : ''}
          <button type="button" data-action="share" class="ml-auto p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Share this paper">
            <i data-lucide="share-2" class="w-4 h-4"></i></button>
        </div>
      </article>`;
  }

  function chip(label, active, attrs) {
    return `<button type="button" ${attrs} aria-pressed="${active}" class="vault-chip${active ? ' is-active' : ''}">${esc(label)}</button>`;
  }

  function renderFilters() {
    const boards = TAX.boards.filter((b) => papers.some((p) => p.board === b.value));
    $('filter-board').innerHTML = boards.map((b) => chip(b.label, state.board.includes(b.value), `data-board="${b.value}"`)).join('');

    const classes = TAX.classes.filter((c) => papers.some((p) => p.class_grade === c.value));
    $('filter-class').innerHTML = classes.map((c) => chip(c.value === 13 ? 'Dropper' : `${c.value}th`, state.cls.includes(c.value), `data-class="${c.value}"`)).join('');

    const years = [...new Set(papers.map((p) => p.exam_year))].sort((a, b) => b - a);
    $('filter-year').innerHTML = years.map((y) => chip(String(y), state.year.includes(y), `data-year="${y}"`)).join('');

    document.querySelectorAll('.vault-tab').forEach((t) => {
      const on = t.dataset.type === state.type;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on);
    });

    const subj = subjects().find((s) => slug(s) === state.subject);
    $('subject-label').textContent = subj || 'All subjects';
    $('filter-solutions').checked = state.sol;
    $('vault-sort').value = state.sort;
    if ($('vault-search').value !== state.q) $('vault-search').value = state.q;
  }

  function subjects() {
    return [...new Set(papers.map((p) => p.subject))].sort();
  }

  function renderSubjectList() {
    const term = $('subject-search').value.trim().toLowerCase();
    const items = [['', 'All subjects'], ...subjects().filter((s) => s.toLowerCase().includes(term)).map((s) => [slug(s), s])];
    $('subject-list').innerHTML = items.map(([v, l]) =>
      `<li><button type="button" role="option" aria-selected="${v === state.subject}" data-subject="${v}"
        class="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-50 ${v === state.subject ? 'text-indigo-700 font-semibold' : 'text-slate-700'}">${esc(l)}</button></li>`).join('')
      || '<li class="px-3 py-2 text-slate-400">No subjects found</li>';
  }

  function renderActive() {
    const pills = [];
    const pill = (label, key, value) => pills.push(
      `<button type="button" data-remove="${key}" data-value="${esc(value)}" class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full pl-3 pr-2 py-1 text-xs font-medium hover:bg-indigo-100">${esc(label)} <i data-lucide="x" class="w-3.5 h-3.5"></i></button>`);
    if (state.q) pill(`“${state.q}”`, 'q', '');
    if (state.type) pill(CATEGORY[state.type]?.label || state.type, 'type', '');
    state.board.forEach((b) => pill(BOARD_LABEL[b] || b, 'board', b));
    state.cls.forEach((c) => pill(CLASS_LABEL[c] || c, 'cls', c));
    if (state.subject) pill(subjects().find((s) => slug(s) === state.subject) || state.subject, 'subject', '');
    state.year.forEach((y) => pill(String(y), 'year', y));
    if (state.sol) pill('With solutions', 'sol', '');
    const box = $('vault-active');
    $('vault-active-wrap').classList.toggle('hidden', !pills.length);
    box.innerHTML = pills.join('') + (pills.length ? '<button type="button" data-clear-all class="text-xs font-semibold text-slate-500 hover:text-indigo-700 ml-1">Clear all</button>' : '');
    const n = state.board.length + state.cls.length + state.year.length + (state.subject ? 1 : 0) + (state.sol ? 1 : 0);
    $('filter-count').textContent = n;
    $('filter-count').classList.toggle('hidden', !n);
  }

  function render(resetPaging = true) {
    if (resetPaging) shown = PAGE_SIZE;
    const list = filtered();
    $('vault-results').innerHTML = list.slice(0, shown).map(card).join('');
    $('vault-empty').classList.toggle('hidden', list.length > 0);
    $('vault-more-wrap').classList.toggle('hidden', list.length <= shown);
    $('vault-count').textContent = `${list.length} ${list.length === 1 ? 'paper' : 'papers'} found`;
    renderFilters();
    renderActive();
    icons();
  }

  function update() {
    writeUrl();
    render();
  }

  // ---------- Downloads & lead gate ----------
  let pendingAction = null;
  let leadPaper = null;

  async function gated(paper, action) {
    if (!paper.is_lead_gated || await isUnlocked()) return action();
    leadPaper = paper;
    pendingAction = action;
    openModal('lead-modal');
    setTimeout(() => $('lead-phone').focus(), 50);
  }

  function triggerDownload(paper, kind) {
    const path = kind === 'solution' ? paper.solution_pdf_path : paper.question_pdf_path;
    const name = `${slug(paper.title)}${kind === 'solution' ? '-solution' : ''}.pdf`;
    const a = document.createElement('a');
    a.href = fileUrl(path, name);
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (kind === 'paper') recordDownload(paper);
    if (typeof showToast === 'function') showToast(kind === 'solution' ? 'Solution download started.' : 'Paper download started. All the best!');
  }

  // ---------- Preview (PDF.js renders pages to canvas, no download prompt) ----------
  let previewToken = 0;

  async function openPreview(paper) {
    const token = ++previewToken;
    writeUrl(paper.id);
    $('preview-title').textContent = paper.title;
    $('preview-badge').innerHTML = badge(paper);
    const pages = $('preview-pages');
    pages.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 text-sm gap-2"><span class="vault-spinner"></span> Loading preview…</div>';

    const actions = [`<button type="button" data-pv="download" class="btn-primary text-sm py-2 px-4"><i data-lucide="download" class="w-4 h-4"></i> Download Paper</button>`];
    if (paper.solution_pdf_path) actions.unshift(`<button type="button" data-pv="solution" class="btn-outline-dark text-sm py-2 px-4"><i data-lucide="file-check-2" class="w-4 h-4"></i> Download Solution</button>`);
    $('preview-actions').innerHTML = actions.join('');
    $('preview-actions').dataset.id = paper.id;
    openModal('preview-modal');
    icons();

    const limit = paper.is_lead_gated && !(await isUnlocked()) ? 2 : Infinity;
    try {
      if (!window.pdfjsLib) throw new Error('PDF viewer unavailable');
      const pdf = await pdfjsLib.getDocument(fileUrl(paper.question_pdf_path)).promise;
      if (token !== previewToken) return;
      pages.innerHTML = '';
      const width = Math.min(pages.clientWidth - 32, 820);
      const count = Math.min(pdf.numPages, limit);
      for (let i = 1; i <= count; i++) {
        const page = await pdf.getPage(i);
        if (token !== previewToken) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const ratio = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${vp.width / ratio}px`;
        canvas.className = 'mx-auto bg-white shadow rounded block';
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        pages.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
      if (pdf.numPages > count) {
        pages.insertAdjacentHTML('beforeend', `
          <div class="max-w-md mx-auto text-center bg-white rounded-2xl shadow p-6">
            <i data-lucide="lock" class="w-8 h-8 text-indigo-600 mx-auto mb-2"></i>
            <h3 class="font-heading font-semibold text-slate-900 mb-1">${pdf.numPages - count} more ${pdf.numPages - count === 1 ? 'page' : 'pages'} in the full paper</h3>
            <p class="text-sm text-slate-500 mb-4">Unlock the complete paper and answer key with your WhatsApp number.</p>
            <button type="button" data-pv="unlock" class="btn-primary text-sm py-2.5 px-5"><i data-lucide="unlock" class="w-4 h-4"></i> Unlock full paper</button>
          </div>`);
        icons();
      }
    } catch (err) {
      if (token !== previewToken) return;
      pages.innerHTML = `<div class="text-center text-slate-500 text-sm py-16">Sorry, the preview couldn't be loaded. You can still download the paper.</div>`;
    }
  }

  // ---------- Modals ----------
  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    $(id).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    $(id).classList.add('hidden');
    if (id === 'preview-modal') { previewToken++; writeUrl(); }
    if (id === 'lead-modal') { pendingAction = null; }
    if (document.querySelectorAll('.vault-modal:not(.hidden)').length === 0) document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  // ---------- Share ----------
  let sharePaper = null;
  async function share(paper, button) {
    const url = paperLink(paper);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: paper.title, url }); } catch (e) { /* cancelled */ }
      return;
    }
    sharePaper = paper;
    const menu = $('share-menu');
    const r = button.getBoundingClientRect();
    menu.style.top = `${Math.min(r.bottom + 6, innerHeight - 110)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - 208, innerWidth - 216))}px`;
    menu.classList.remove('hidden');
  }

  // ---------- Events ----------
  function bind() {
    let timer;
    $('vault-search').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 300);
    });

    $('vault-tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-type]');
      if (!t) return;
      state.type = t.dataset.type;
      update();
    });

    const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    $('vault-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-board],[data-class],[data-year]');
      if (!b) return;
      if (b.dataset.board) state.board = toggle(state.board, b.dataset.board);
      if (b.dataset.class) state.cls = toggle(state.cls, Number(b.dataset.class));
      if (b.dataset.year) state.year = toggle(state.year, Number(b.dataset.year));
      update();
    });

    $('filter-solutions').addEventListener('change', (e) => { state.sol = e.target.checked; update(); });
    $('vault-sort').addEventListener('change', (e) => { state.sort = e.target.value; update(); });

    // Subject combobox
    const panel = $('subject-panel');
    $('subject-toggle').addEventListener('click', () => {
      const open = panel.classList.toggle('hidden') === false;
      $('subject-toggle').setAttribute('aria-expanded', open);
      if (open) { $('subject-search').value = ''; renderSubjectList(); $('subject-search').focus(); }
    });
    $('subject-search').addEventListener('input', renderSubjectList);
    $('subject-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-subject]');
      if (!b) return;
      state.subject = b.dataset.subject;
      panel.classList.add('hidden');
      $('subject-toggle').setAttribute('aria-expanded', 'false');
      update();
    });

    // Mobile filter drawer
    $('vault-filters-open').addEventListener('click', () => $('vault-filters').classList.add('is-open'));
    $('vault-filters-close').addEventListener('click', () => $('vault-filters').classList.remove('is-open'));

    $('vault-more').addEventListener('click', () => { shown += PAGE_SIZE; render(false); });

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-clear-all]')) {
        Object.assign(state, { q: '', type: '', board: [], cls: [], subject: '', year: [], sol: false });
        $('vault-search').value = '';
        update();
        return;
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const { remove: k, value: v } = rm.dataset;
        if (k === 'q') { state.q = ''; $('vault-search').value = ''; }
        if (k === 'type') state.type = '';
        if (k === 'subject') state.subject = '';
        if (k === 'sol') state.sol = false;
        if (k === 'board') state.board = state.board.filter((x) => x !== v);
        if (k === 'cls') state.cls = state.cls.filter((x) => x !== Number(v));
        if (k === 'year') state.year = state.year.filter((x) => x !== Number(v));
        update();
        return;
      }
      if (!e.target.closest('#subject-combo')) panel.classList.add('hidden');
      if (!e.target.closest('#share-menu') && !e.target.closest('[data-action="share"]')) $('share-menu').classList.add('hidden');
      if (e.target.closest('[data-close]')) closeModal(e.target.closest('.vault-modal').id);
    });

    // Card actions
    $('vault-results').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const paper = papers.find((p) => p.id === btn.closest('[data-id]').dataset.id);
      if (!paper) return;
      const a = btn.dataset.action;
      if (a === 'preview') openPreview(paper);
      if (a === 'download') gated(paper, () => triggerDownload(paper, 'paper'));
      if (a === 'solution') gated(paper, () => triggerDownload(paper, 'solution'));
      if (a === 'share') share(paper, btn);
    });

    $('preview-modal').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pv]');
      if (!btn) return;
      const paper = papers.find((p) => p.id === $('preview-actions').dataset.id);
      if (!paper) return;
      if (btn.dataset.pv === 'download') gated(paper, () => triggerDownload(paper, 'paper'));
      if (btn.dataset.pv === 'solution') gated(paper, () => triggerDownload(paper, 'solution'));
      if (btn.dataset.pv === 'unlock') gated(paper, () => openPreview(paper));
    });

    $('share-menu').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-share]');
      if (!b || !sharePaper) return;
      const url = paperLink(sharePaper);
      if (b.dataset.share === 'copy') {
        try { await navigator.clipboard.writeText(url); showToast('Link copied to clipboard.'); }
        catch (err) { prompt('Copy this link:', url); }
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${sharePaper.title} — free on Young Minds Academy Exam Vault: ${url}`)}`, '_blank', 'noopener');
      }
      $('share-menu').classList.add('hidden');
    });

    $('lead-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = $('lead-phone').value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
      const valid = /^[6-9]\d{9}$/.test(phone);
      $('lead-error').classList.toggle('hidden', valid);
      if (!valid) { $('lead-phone').focus(); return; }
      const submit = e.target.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await saveLead(leadPaper, phone, $('lead-name').value.trim());
        const action = pendingAction;
        closeModal('lead-modal');
        e.target.reset();
        if (action) action();
      } catch (err) {
        $('lead-error').textContent = 'Something went wrong. Please try again.';
        $('lead-error').classList.remove('hidden');
      } finally {
        submit.disabled = false;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      $('share-menu').classList.add('hidden');
      const open = [...document.querySelectorAll('.vault-modal:not(.hidden)')].pop();
      if (open) closeModal(open.id);
      else $('vault-filters').classList.remove('is-open');
    });
  }

  // ---------- Init ----------
  async function init() {
    $('vault-demo-banner').classList.toggle('hidden', !!sb);
    const deepLink = readUrl();
    bind();
    try {
      papers = (await loadPapers()).map((p) => ({ ...p, _hay: haystack(p) }));
    } catch (err) {
      $('vault-count').textContent = 'Could not load papers. Please refresh the page.';
      return;
    }
    render();
    if (deepLink) {
      const p = papers.find((x) => x.id === deepLink);
      if (p) openPreview(p);
    }
  }

  init();
})();
