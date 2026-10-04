// Exam Vault — admin dashboard.
// Access is checked here for the UI, and enforced by Supabase Row Level Security
// (supabase/schema.sql), so non-admins can't write papers or files even by calling the API directly.
(function () {
  const CFG = window.YMA_VAULT_CONFIG || {};
  const TAX = window.YMA_TAXONOMY;
  const BUCKET = CFG.bucket || 'papers';
  const MAX_BYTES = 25 * 1024 * 1024;
  const PAGE = 20;
  const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

  const configured = CFG.supabaseUrl && !CFG.supabaseUrl.startsWith('YOUR_') &&
    CFG.supabaseAnonKey && !CFG.supabaseAnonKey.startsWith('YOUR_');
  const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icons = () => window.lucide && lucide.createIcons();
  const BOARD = Object.fromEntries(TAX.boards.map((b) => [b.value, b.label]));
  const CLASS = Object.fromEntries(TAX.classes.map((c) => [c.value, c.label]));
  const CAT = Object.fromEntries(TAX.categories.map((c) => [c.value, c]));

  function toast(msg, error) {
    const t = $('toast');
    $('toast-msg').textContent = msg;
    t.classList.toggle('bg-green-600', !error);
    t.classList.toggle('bg-rose-600', !!error);
    t.classList.remove('translate-x-full', 'opacity-0');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('translate-x-full', 'opacity-0'), 3500);
  }

  // ---------- Data layer: Supabase, or in-memory sample data in preview mode ----------
  const supabaseApi = {
    async list() {
      const { data, error } = await sb.from('question_papers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async insert(row) {
      const { data, error } = await sb.from('question_papers').insert(row).select().single();
      if (error) throw error;
      return data;
    },
    async update(id, patch) {
      const { data, error } = await sb.from('question_papers').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async remove(id) {
      const { error } = await sb.from('question_papers').delete().eq('id', id);
      if (error) throw error;
    },
    async upload(path, file) {
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (error) throw error;
    },
    async removeFiles(paths) {
      const list = paths.filter(Boolean);
      if (list.length) await sb.storage.from(BUCKET).remove(list);
    },
    async leads() {
      const { data, error } = await sb.from('paper_leads').select('*, question_papers(title)').order('created_at', { ascending: false }).limit(2000);
      if (error) throw error;
      return data;
    },
  };

  let memory = [];
  const previewApi = {
    async list() { return memory; },
    async insert(row) {
      const r = { ...row, id: crypto.randomUUID(), download_count: 0, created_at: new Date().toISOString() };
      memory.unshift(r);
      return r;
    },
    async update(id, patch) {
      const r = memory.find((p) => p.id === id);
      Object.assign(r, patch);
      return r;
    },
    async remove(id) { memory = memory.filter((p) => p.id !== id); },
    async upload() { /* nothing is uploaded in preview mode */ },
    async removeFiles() {},
    async leads() {
      return memory.filter((p) => p.is_lead_gated).slice(0, 4).map((p, i) => ({
        id: String(i), created_at: new Date(Date.now() - i * 86400000).toISOString(),
        whatsapp: `98${i}00${i}2345`.slice(0, 10), student_name: ['Aarav', 'Diya', '', 'Kabir'][i], class_grade: p.class_grade,
        question_papers: { title: p.title },
      }));
    },
  };

  let api = sb ? supabaseApi : previewApi;

  // ---------- Views & auth ----------
  function show(view) {
    ['setup', 'login', 'denied', 'app'].forEach((v) => $(`view-${v}`).classList.toggle('hidden', v !== view));
  }

  async function checkAccess() {
    const { data } = await sb.auth.getSession();
    const session = data.session;
    $('signout-wrap').classList.toggle('hidden', !session);
    $('admin-user').textContent = session ? session.user.email : '';
    if (!session) return show('login');
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    if (!profile || !ADMIN_ROLES.includes(profile.role)) return show('denied');
    show('app');
    await refresh();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('login-error').classList.add('hidden');
    const { error } = await sb.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value });
    if (error) {
      $('login-error').textContent = error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message;
      $('login-error').classList.remove('hidden');
      return;
    }
    await checkAccess();
  });

  $('signout').addEventListener('click', async () => {
    if (sb) await sb.auth.signOut();
    location.reload();
  });

  $('start-preview').addEventListener('click', async () => {
    memory = (await (await fetch('../../data/sample-papers.json')).json());
    $('preview-notice').classList.remove('hidden');
    show('app');
    await refresh();
  });

  // ---------- Tabs ----------
  function openTab(name) {
    document.querySelectorAll('#admin-tabs [data-tab]').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
    if (name === 'leads') loadLeads();
    window.scrollTo({ top: 0 });
  }
  $('admin-tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    if (t.dataset.tab === 'form' && !editing) resetForm();
    openTab(t.dataset.tab);
  });

  // ---------- Papers table ----------
  let papers = [];
  let page = 0;

  async function refresh() {
    try {
      papers = await api.list();
    } catch (err) {
      toast(`Couldn't load papers: ${err.message}`, true);
      papers = [];
    }
    renderTable();
  }

  function liveStatus(p) {
    if (p.status === 'SCHEDULED' && p.scheduled_at && new Date(p.scheduled_at) <= new Date()) return ['Live (scheduled)', 'bg-green-100 text-green-700'];
    if (p.status === 'SCHEDULED') return [`Scheduled · ${new Date(p.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`, 'bg-amber-100 text-amber-800'];
    if (p.status === 'PUBLISHED') return ['Published', 'bg-green-100 text-green-700'];
    return ['Draft', 'bg-slate-100 text-slate-600'];
  }

  function tableRows() {
    const q = $('table-search').value.trim().toLowerCase();
    const st = $('table-status').value;
    return papers.filter((p) => (!st || p.status === st) &&
      (!q || [p.title, p.subject, p.exam_year, p.paper_set, (p.tags || []).join(' ')].join(' ').toLowerCase().includes(q)));
  }

  function renderTable() {
    const rows = tableRows();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages - 1);
    const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
    $('papers-body').innerHTML = slice.map((p) => {
      const [label, cls] = liveStatus(p);
      const visible = label.startsWith('Published') || label.startsWith('Live');
      return `<tr data-id="${esc(p.id)}" class="hover:bg-slate-50">
        <td class="px-4 py-3 max-w-xs"><div class="font-medium text-slate-800 line-clamp-2">${esc(p.title)}</div>
          ${p.is_featured ? '<span class="text-xs text-amber-700">★ Featured</span> ' : ''}${p.is_lead_gated ? '<span class="text-xs text-slate-500">· WhatsApp gated</span>' : ''}</td>
        <td class="px-4 py-3 whitespace-nowrap">${esc(BOARD[p.board] || p.board)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${esc(CLASS[p.class_grade] || p.class_grade)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${esc(CAT[p.category]?.short || p.category)}</td>
        <td class="px-4 py-3">${esc(p.exam_year)}</td>
        <td class="px-4 py-3 text-right">${Number(p.download_count || 0).toLocaleString('en-IN')}</td>
        <td class="px-4 py-3"><span class="inline-block text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${cls}">${esc(label)}</span></td>
        <td class="px-4 py-3 whitespace-nowrap text-slate-500">${new Date(p.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td>
        <td class="px-4 py-3">
          <div class="flex justify-end gap-1">
            <button type="button" data-act="edit" class="admin-icon-btn" title="Edit"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button type="button" data-act="toggle" class="admin-icon-btn" title="${visible ? 'Unpublish' : 'Publish now'}"><i data-lucide="${visible ? 'eye-off' : 'eye'}" class="w-4 h-4"></i></button>
            <button type="button" data-act="replace" class="admin-icon-btn" title="Replace question PDF"><i data-lucide="file-up" class="w-4 h-4"></i></button>
            <button type="button" data-act="delete" class="admin-icon-btn text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="px-4 py-10 text-center text-slate-400">No papers yet. Click "New paper" to upload one.</td></tr>';
    $('table-info').textContent = rows.length ? `Showing ${page * PAGE + 1}–${page * PAGE + slice.length} of ${rows.length}` : '';
    $('page-prev').disabled = page === 0;
    $('page-next').disabled = page >= pages - 1;
    icons();
  }

  $('table-search').addEventListener('input', () => { page = 0; renderTable(); });
  $('table-status').addEventListener('change', () => { page = 0; renderTable(); });
  $('page-prev').addEventListener('click', () => { page--; renderTable(); });
  $('page-next').addEventListener('click', () => { page++; renderTable(); });
  $('new-paper').addEventListener('click', () => { resetForm(); openTab('form'); });

  let replacing = null;
  $('papers-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const p = papers.find((x) => x.id === btn.closest('[data-id]').dataset.id);
    if (!p) return;
    const act = btn.dataset.act;
    try {
      if (act === 'edit') { fillForm(p); openTab('form'); }
      if (act === 'toggle') {
        const visible = liveStatus(p)[0].match(/^(Published|Live)/);
        await api.update(p.id, visible ? { status: 'DRAFT' } : { status: 'PUBLISHED', scheduled_at: null });
        toast(visible ? 'Paper unpublished.' : 'Paper published.');
        await refresh();
      }
      if (act === 'replace') { replacing = p; $('replace-input').click(); }
      if (act === 'delete') {
        if (!confirm(`Delete "${p.title}"? This also deletes its PDFs and can't be undone.`)) return;
        await api.remove(p.id);
        await api.removeFiles([p.question_pdf_path, p.solution_pdf_path]);
        toast('Paper deleted.');
        await refresh();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('replace-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !replacing) return;
    const problem = checkFile(file);
    if (problem) return toast(problem, true);
    try {
      const path = storagePath(replacing, 'question');
      await api.upload(path, file);
      await api.update(replacing.id, { question_pdf_path: path, file_size_mb: mb(file) });
      if (sb) await api.removeFiles([replacing.question_pdf_path]);
      toast('Question PDF replaced.');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- Upload / edit form ----------
  let editing = null;
  let tags = [];
  let titleTouched = false;
  const files = { question: null, solution: null };

  const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
  function setupSelects() {
    $('f-board').innerHTML = TAX.boards.map((b) => opt(b.value, b.label)).join('');
    $('f-class').innerHTML = TAX.classes.map((c) => opt(c.value, c.label, c.value === 10)).join('');
    $('f-category').innerHTML = TAX.categories.map((c) => opt(c.value, c.label)).join('');
    const now = new Date().getFullYear();
    const years = [];
    for (let y = now + 1; y >= TAX.firstYear; y--) years.push(y);
    $('f-year').innerHTML = years.map((y) => opt(y, y, y === now)).join('');
    $('f-region').innerHTML = opt('', '—') + TAX.regions.map((r) => opt(r, r)).join('');
    fillSubjects();
  }

  function fillSubjects(selected) {
    const cls = Number($('f-class').value);
    const base = cls <= 10 ? TAX.subjects.junior : TAX.subjects.senior;
    const custom = papers.map((p) => p.subject).filter((s) => !TAX.subjects.junior.includes(s) && !TAX.subjects.senior.includes(s));
    const all = [...new Set([...base, ...custom])];
    if (selected && !all.includes(selected)) all.push(selected);
    $('f-subject').innerHTML = all.map((s) => opt(s, s, s === selected)).join('') + opt('__custom', '+ Add custom subject…');
    toggleCustomSubject();
  }

  function toggleCustomSubject() {
    $('f-subject-custom').classList.toggle('hidden', $('f-subject').value !== '__custom');
  }

  function subjectValue() {
    return $('f-subject').value === '__custom' ? $('f-subject-custom').value.trim() : $('f-subject').value;
  }

  function suggestedTitle() {
    const cls = Number($('f-class').value);
    return [BOARD[$('f-board').value], cls === 13 ? 'Dropper' : `Class ${cls}`, subjectValue(),
      CAT[$('f-category').value]?.short, $('f-year').value, $('f-set').value.trim()].filter(Boolean).join(' ');
  }

  function updateSuggestion() {
    const s = suggestedTitle();
    $('use-suggested').textContent = s;
    if (!titleTouched) $('f-title').value = s;
  }

  function renderTags() {
    const box = $('tag-box');
    box.querySelectorAll('.tag-chip').forEach((c) => c.remove());
    tags.forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full pl-2.5 pr-1.5 py-1';
      chip.innerHTML = `${esc(t)} <button type="button" data-tag="${i}" aria-label="Remove ${esc(t)}" class="hover:text-rose-600">×</button>`;
      box.insertBefore(chip, $('f-tag-input'));
    });
  }

  function addTag(raw) {
    raw.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => {
      if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    });
    renderTags();
  }

  $('tag-box').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) { tags.splice(Number(b.dataset.tag), 1); renderTags(); }
    $('f-tag-input').focus();
  });
  $('f-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(e.target.value);
      e.target.value = '';
    } else if (e.key === 'Backspace' && !e.target.value && tags.length) {
      tags.pop();
      renderTags();
    }
  });
  $('f-tag-input').addEventListener('blur', (e) => { if (e.target.value.trim()) { addTag(e.target.value); e.target.value = ''; } });

  ['f-board', 'f-subject', 'f-year', 'f-set', 'f-subject-custom'].forEach((id) => $(id).addEventListener('input', updateSuggestion));
  $('f-class').addEventListener('change', () => { fillSubjects(subjectValue()); updateSuggestion(); });
  $('f-subject').addEventListener('change', () => { toggleCustomSubject(); updateSuggestion(); });
  $('f-category').addEventListener('change', () => {
    if (!editing) $('f-gated').checked = $('f-category').value === 'GUESS_PAPER';
    updateSuggestion();
  });
  $('f-title').addEventListener('input', () => { titleTouched = $('f-title').value.trim() !== ''; });
  $('use-suggested').addEventListener('click', () => { $('f-title').value = suggestedTitle(); titleTouched = false; });
  document.querySelectorAll('input[name="status"]').forEach((r) => r.addEventListener('change', () => {
    $('schedule-wrap').classList.toggle('hidden', statusValue() !== 'SCHEDULED');
  }));
  const statusValue = () => document.querySelector('input[name="status"]:checked').value;

  // File drop zones
  function checkFile(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files can be uploaded.';
    if (file.size > MAX_BYTES) return 'That file is larger than 25 MB.';
    return null;
  }
  const mb = (file) => Math.round((file.size / 1048576) * 100) / 100;

  function setFile(kind, file) {
    const zone = document.querySelector(`[data-drop="${kind}"]`);
    const label = zone.querySelector('[data-file-label]');
    if (file) {
      const problem = checkFile(file);
      if (problem) { toast(problem, true); return; }
      files[kind] = file;
      label.textContent = `${file.name} · ${file.size < 1048576 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : mb(file) + ' MB'}`;
      zone.classList.add('has-file');
    } else {
      files[kind] = null;
      zone.classList.remove('has-file');
      const existing = editing && (kind === 'question' ? editing.question_pdf_path : editing.solution_pdf_path);
      label.textContent = existing ? `Current: ${existing.split('/').pop()} — drop a new PDF to replace`
        : kind === 'question' ? 'Drop PDF here or click to browse' : 'Optional — drop PDF here';
    }
  }

  document.querySelectorAll('[data-drop]').forEach((zone) => {
    const kind = zone.dataset.drop;
    const input = zone.querySelector('input[type="file"]');
    input.addEventListener('change', () => setFile(kind, input.files[0]));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag');
      if (e.dataTransfer.files[0]) setFile(kind, e.dataTransfer.files[0]);
    });
  });

  function resetForm() {
    editing = null;
    $('paper-form').reset();
    $('form-heading').textContent = 'Document details';
    $('form-submit').querySelector('span').textContent = 'Save paper';
    $('tab-form-btn').textContent = 'Upload paper';
    tags = [];
    renderTags();
    titleTouched = false;
    setupSelects();
    $('f-gated').checked = false;
    $('schedule-wrap').classList.add('hidden');
    $('remove-solution-wrap').classList.add('hidden');
    $('form-error').classList.add('hidden');
    setFile('question', null);
    setFile('solution', null);
    updateSuggestion();
  }

  function fillForm(p) {
    resetForm();
    editing = p;
    $('form-heading').textContent = 'Edit paper';
    $('form-submit').querySelector('span').textContent = 'Save changes';
    $('tab-form-btn').textContent = 'Edit paper';
    $('f-board').value = p.board;
    $('f-class').value = p.class_grade;
    fillSubjects(p.subject);
    $('f-subject').value = p.subject;
    $('f-category').value = p.category;
    if (![...$('f-year').options].some((o) => Number(o.value) === p.exam_year)) $('f-year').insertAdjacentHTML('beforeend', opt(p.exam_year, p.exam_year));
    $('f-year').value = p.exam_year;
    $('f-region').value = p.region || '';
    $('f-set').value = p.paper_set || '';
    $('f-title').value = p.title;
    titleTouched = true;
    tags = [...(p.tags || [])];
    renderTags();
    $('f-included').checked = p.solution_type === 'INCLUDED_IN_MAIN_PDF';
    $('f-video').value = p.solution_video_url || '';
    document.querySelector(`input[name="status"][value="${p.status}"]`).checked = true;
    $('schedule-wrap').classList.toggle('hidden', p.status !== 'SCHEDULED');
    if (p.scheduled_at) {
      const d = new Date(p.scheduled_at);
      $('f-schedule').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    $('f-featured').checked = !!p.is_featured;
    $('f-recommended').checked = !!p.is_recommended;
    $('f-gated').checked = !!p.is_lead_gated;
    $('remove-solution-wrap').classList.toggle('hidden', !p.solution_pdf_path);
    setFile('question', null);
    setFile('solution', null);
    updateSuggestion();
  }

  function storagePath(meta, kind) {
    return `${meta.board}/class-${meta.class_grade}/${meta.exam_year}/${crypto.randomUUID()}-${kind}.pdf`;
  }

  function formError(msg) {
    $('form-error').textContent = msg;
    $('form-error').classList.remove('hidden');
  }

  $('form-cancel').addEventListener('click', () => { resetForm(); openTab('papers'); });

  $('paper-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('form-error').classList.add('hidden');
    const subject = subjectValue();
    const title = $('f-title').value.trim();
    const status = statusValue();
    const video = $('f-video').value.trim();
    if (!subject) return formError('Please choose or enter a subject.');
    if (!title) return formError('Please enter a title.');
    if (!editing && !files.question) return formError('Please add the question paper PDF.');
    if (status === 'SCHEDULED' && !$('f-schedule').value) return formError('Please choose when the paper should go live.');
    if (video && !/^https?:\/\/\S+$/i.test(video)) return formError('The video URL should start with https://');

    const removeSolution = editing && $('f-remove-solution').checked;
    const keepsSolutionPdf = files.solution || (editing && editing.solution_pdf_path && !removeSolution);
    const row = {
      title,
      board: $('f-board').value,
      class_grade: Number($('f-class').value),
      subject,
      category: $('f-category').value,
      exam_year: Number($('f-year').value),
      paper_set: $('f-set').value.trim() || null,
      region: $('f-region').value || null,
      tags,
      solution_type: keepsSolutionPdf ? 'SEPARATE_SOLUTION_PDF' : $('f-included').checked ? 'INCLUDED_IN_MAIN_PDF' : 'NONE',
      solution_video_url: video || null,
      is_featured: $('f-featured').checked,
      is_recommended: $('f-recommended').checked,
      is_lead_gated: $('f-gated').checked,
      status,
      scheduled_at: status === 'SCHEDULED' ? new Date($('f-schedule').value).toISOString() : null,
    };

    const submit = $('form-submit');
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Saving…';
    const uploaded = [];
    const obsolete = [];
    try {
      if (files.question) {
        row.question_pdf_path = storagePath(row, 'question');
        row.file_size_mb = mb(files.question);
        await api.upload(row.question_pdf_path, files.question);
        uploaded.push(row.question_pdf_path);
        if (editing) obsolete.push(editing.question_pdf_path);
      }
      if (files.solution) {
        row.solution_pdf_path = storagePath(row, 'solution');
        await api.upload(row.solution_pdf_path, files.solution);
        uploaded.push(row.solution_pdf_path);
        if (editing && editing.solution_pdf_path) obsolete.push(editing.solution_pdf_path);
      } else if (removeSolution) {
        row.solution_pdf_path = null;
        obsolete.push(editing.solution_pdf_path);
      }

      if (editing) await api.update(editing.id, row);
      else await api.insert(row);
      await api.removeFiles(obsolete);

      toast(editing ? 'Paper updated.' : 'Paper saved.');
      resetForm();
      openTab('papers');
      await refresh();
    } catch (err) {
      await api.removeFiles(uploaded); // don't leave orphaned files behind
      formError(err.message || 'Something went wrong while saving.');
    } finally {
      submit.disabled = false;
      submit.querySelector('span').textContent = editing ? 'Save changes' : 'Save paper';
    }
  });

  // ---------- Leads ----------
  let leads = [];
  async function loadLeads() {
    try {
      leads = await api.leads();
    } catch (err) {
      toast(`Couldn't load leads: ${err.message}`, true);
      leads = [];
    }
    $('leads-info').textContent = `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}`;
    $('leads-body').innerHTML = leads.map((l) => `<tr>
      <td class="px-4 py-3 whitespace-nowrap text-slate-500">${new Date(l.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
      <td class="px-4 py-3 whitespace-nowrap"><a href="https://wa.me/91${esc(l.whatsapp)}" target="_blank" rel="noopener" class="text-green-700 font-medium hover:underline">+91 ${esc(l.whatsapp)}</a></td>
      <td class="px-4 py-3">${esc(l.student_name || '—')}</td>
      <td class="px-4 py-3 whitespace-nowrap">${esc(CLASS[l.class_grade] || '—')}</td>
      <td class="px-4 py-3 text-slate-600">${esc(l.question_papers?.title || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="px-4 py-10 text-center text-slate-400">No leads yet.</td></tr>';
  }

  $('leads-export').addEventListener('click', () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [['Date', 'WhatsApp', 'Student', 'Class', 'Paper'].map(cell).join(',')]
      .concat(leads.map((l) => [new Date(l.created_at).toISOString(), `+91${l.whatsapp}`, l.student_name, CLASS[l.class_grade], l.question_papers?.title].map(cell).join(',')))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `exam-vault-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- Init ----------
  setupSelects();
  resetForm();
  icons();
  if (!sb) {
    show('setup');
  } else {
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') show('login'); });
    checkAccess();
  }
})();
