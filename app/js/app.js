(function () {
  'use strict';

  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const state = { logbooks: [], entries: [] };
  let editorDraft = null;
  let busy = false;

  // ---------- Hilfsfunktionen ----------

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad = n => String(n).padStart(2, '0');
  const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (iso, n) => { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoDate(d); };
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseDate(s));
  const fmtLong = iso => parseDate(iso).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtFull = iso => parseDate(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const hasAnswer = v => Array.isArray(v) ? v.length > 0
    : v && typeof v === 'object' ? !!(v.text || v.color)
    : String(v == null ? '' : v).trim() !== '';
  const go = hash => { location.hash = hash; };
  const draftKey = (lbId, date) => `draft:${lbId}:${date}`;

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  // ---------- Tagesfazit: 1–3 Zeichen plus Farbe, sichtbar im Kalender ----------

  const COLORS = [
    { key: 'red', name: 'Rot' }, { key: 'orange', name: 'Orange' }, { key: 'yellow', name: 'Gelb' },
    { key: 'green', name: 'Grün' }, { key: 'teal', name: 'Türkis' }, { key: 'blue', name: 'Blau' },
    { key: 'violet', name: 'Lila' }, { key: 'pink', name: 'Pink' }, { key: 'grey', name: 'Grau' },
  ];
  const MARK_MAX = 3;
  const colorKey = c => (COLORS.some(x => x.key === c) ? c : '');
  const colorName = c => (COLORS.find(x => x.key === c) || {}).name || '';
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('de', { granularity: 'grapheme' }) : null;
  const graphemes = s => (segmenter ? [...segmenter.segment(String(s || ''))].map(x => x.segment) : Array.from(String(s || '')));
  const clampMark = s => graphemes(String(s || '').replace(/\s+/g, '')).slice(0, MARK_MAX).join('');
  // Farbverlauf von schlecht nach gut, wenn aus einer Auswahlfrage ein Tagesfazit wird
  const GRADIENTS = { 2: ['red', 'green'], 3: ['red', 'yellow', 'green'], 4: ['red', 'yellow', 'teal', 'green'], 5: ['red', 'orange', 'yellow', 'teal', 'green'] };
  const autoColor = (i, n) => (GRADIENTS[n] || COLORS.map(c => c.key))[i % (GRADIENTS[n] ? n : COLORS.length)];

  const markClass = m => {
    const n = graphemes(m.text).length;
    return `c-${colorKey(m.color) || 'none'}${n > 1 ? ' len-' + n : ''}`;
  };
  const markHtml = (m, cls = '') => `<span class="mark ${cls} ${markClass(m)}">${esc(m.text)}</span>`;
  const summaryQ = lb => lb.questions.find(q => q.type === 'summary');

  // Antwort → { text, color }. Ältere Einträge (Text einer Auswahlfrage) werden über das Zeichen zugeordnet.
  function markOf(q, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v.text || v.color ? { text: v.text || '', color: colorKey(v.color) } : null;
    }
    if (typeof v !== 'string' || !v.trim()) return null;
    const hit = (q.marks || []).find(m => m.text && v.startsWith(m.text));
    return hit ? { text: hit.text, color: hit.color } : { text: clampMark(v.trim().split(/\s+/)[0]), color: '' };
  }
  const entryMark = (lb, e) => {
    const q = e && summaryQ(lb);
    return q ? markOf(q, e.answers[q.id]) : null;
  };

  function answerText(q, v) {
    if (q.type === 'summary') {
      const m = markOf(q, v);
      return m ? [m.text, colorName(m.color)].filter(Boolean).join(' · ') : '';
    }
    return Array.isArray(v) ? v.join(', ') : v;
  }

  const logbook = id => state.logbooks.find(l => l.id === id);
  const entriesOf = id => state.entries.filter(e => e.logbookId === id);

  // Ruhetage: Wochentage, die bei einer aktiven Erinnerung abgewählt sind. Ohne Erinnerung zählt jeder Tag.
  const weekday = iso => (parseDate(iso).getDay() + 6) % 7 + 1;   // Mo = 1 … So = 7
  function isRestDay(lb, iso) {
    const r = lb && lb.reminder;
    if (!r || !r.enabled || !Array.isArray(r.days) || !r.days.length) return false;
    return !r.days.includes(weekday(iso));
  }

  // Serie: Einträge an aufeinanderfolgenden Tagen; Ruhetage ohne Eintrag unterbrechen sie nicht,
  // ein Eintrag an einem Ruhetag zählt trotzdem mit.
  function streak(id) {
    const lb = logbook(id);
    const dates = new Set(entriesOf(id).map(e => e.date));
    let day = isoDate();
    if (!dates.has(day)) day = addDays(day, -1);
    let n = 0;
    for (let guard = 0; guard < 4000; guard++) {
      if (dates.has(day)) n++;
      else if (!isRestDay(lb, day)) break;
      day = addDays(day, -1);
    }
    return n;
  }

  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const header = (title, back, sub) => `
    <header class="top">
      <a class="back" href="${back}" aria-label="Zurück">‹</a>
      <div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
    </header>`;

  // ---------- Start ----------

  function homeView() {
    const today = isoDate();
    const cards = state.logbooks.map(lb => {
      const byDate = new Map(entriesOf(lb.id).map(e => [e.date, e]));
      const done = byDate.has(today);
      const n = streak(lb.id);
      const big = !!summaryQ(lb);
      const dots = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        const e = byDate.get(d);
        const m = entryMark(lb, e);
        const rest = !e && isRestDay(lb, d);
        const cls = ['dot', e && 'on', rest && 'rest', m && 'marked ' + markClass(m), i === 0 && 'today'].filter(Boolean).join(' ');
        const label = m && graphemes(m.text).length === 1 ? esc(m.text) : '';
        dots.push(`<span class="${cls}" title="${esc(fmtFull(d))}${rest ? ' · Pause' : ''}">${label}</span>`);
      }
      return `
        <article class="card lb-card${done ? ' done' : ''}">
          <a class="lb-main" href="#/log/${lb.id}">
            <span class="lb-emoji">${esc(lb.emoji)}</span>
            <span class="lb-text">
              <strong>${esc(lb.name)}</strong>
              <span class="lb-status">${done ? '✓ Heute erledigt' : 'Heute noch offen'}</span>
            </span>
            <span class="lb-streak" title="Tage in Folge">${n > 0 ? '🔥 ' + n : ''}</span>
          </a>
          <div class="lb-foot">
            <div class="dots${big ? ' big' : ''}" aria-label="Letzte 7 Tage">${dots.join('')}</div>
            <nav>
              <a href="#/history/${lb.id}">Verlauf</a>
              <a href="#/edit/${lb.id}">Anpassen</a>
            </nav>
          </div>
        </article>`;
    }).join('');

    return `
      <header class="home-head">
        <h1>Logbuch</h1>
        <p class="sub">${esc(fmtLong(today))}</p>
      </header>
      ${cards || '<p class="empty">Noch kein Logbuch. Lege dein erstes an.</p>'}
      <a class="btn ghost wide" href="#/new">+ Neues Logbuch</a>
      <p class="foot-link"><a href="#/data">Daten sichern &amp; exportieren</a></p>`;
  }

  // ---------- Ausfüllen ----------

  function questionHtml(q, value) {
    let input;
    if (q.type === 'text') {
      input = `<textarea rows="1" placeholder="${esc(q.hint || '…')}" aria-label="${esc(q.title)}">${esc(value || '')}</textarea>`;
    } else if (q.type === 'summary') {
      const cur = markOf(q, value);
      input = `<div class="chips marks">${(q.marks || []).map(m => {
        const on = !!cur && cur.text === m.text && cur.color === colorKey(m.color);
        return `<button type="button" class="chip mark-chip" data-action="pick" data-text="${esc(m.text)}" data-color="${esc(colorKey(m.color))}" aria-pressed="${on}" aria-label="${esc(m.text || colorName(m.color))}">${markHtml(m)}</button>`;
      }).join('')}</div>`;
    } else {
      const selected = Array.isArray(value) ? value : (value ? [value] : []);
      input = `<div class="chips">${q.options.map(o =>
        `<button type="button" class="chip" data-action="pick" data-value="${esc(o)}" aria-pressed="${selected.includes(o)}">${esc(o)}</button>`
      ).join('')}</div>`;
    }
    return `
      <section class="card q-card" data-question="${q.id}" data-type="${q.type}">
        <h2>${esc(q.title)}</h2>
        ${q.hint && q.type !== 'text' ? `<p class="hint">${esc(q.hint)}</p>` : ''}
        ${input}
      </section>`;
  }

  function fillView(id, date) {
    const lb = logbook(id);
    if (!lb || !isDate(date) || date > isoDate()) return null;
    const existing = state.entries.find(e => e.id === `${id}_${date}`);
    let answers = existing ? existing.answers : {};
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey(id, date)));
      if (draft) answers = draft;
    } catch (e) { /* kein Entwurf */ }
    const isToday = date === isoDate();
    return `
      <div class="fill" data-logbook="${lb.id}" data-date="${date}">
        <div class="fill-head">
          ${header(lb.emoji + ' ' + lb.name, isToday ? '#/' : '#/history/' + lb.id, fmtLong(date) + (existing ? ' · bereits eingetragen' : ''))}
        </div>
        ${lb.questions.map(q => questionHtml(q, answers[q.id])).join('')}
        <button class="btn primary wide btn-done" data-action="submit">${esc(isToday ? lb.doneLabel + ' ' + Celebrate.emoji(lb.animation) : 'Speichern')}</button>
      </div>`;
  }

  function collectAnswers() {
    const answers = {};
    app.querySelectorAll('[data-question]').forEach(el => {
      const type = el.dataset.type;
      if (type === 'text') {
        answers[el.dataset.question] = el.querySelector('textarea').value.trim();
      } else if (type === 'summary') {
        const c = el.querySelector('.chip[aria-pressed="true"]');
        answers[el.dataset.question] = c ? { text: c.dataset.text, color: c.dataset.color } : '';
      } else {
        const picked = [...el.querySelectorAll('.chip[aria-pressed="true"]')].map(c => c.dataset.value);
        answers[el.dataset.question] = type === 'multi' ? picked : (picked[0] || '');
      }
    });
    return answers;
  }

  function saveDraft() {
    const fill = app.querySelector('.fill');
    if (!fill) return;
    try {
      localStorage.setItem(draftKey(fill.dataset.logbook, fill.dataset.date), JSON.stringify(collectAnswers()));
    } catch (e) { /* Speicher voll oder gesperrt: Entwurf ist nur Komfort */ }
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  async function submitEntry() {
    if (busy) return;
    const fill = app.querySelector('.fill');
    const lb = logbook(fill.dataset.logbook);
    const date = fill.dataset.date;
    const answers = collectAnswers();
    if (!Object.values(answers).some(hasAnswer)) {
      toast('Beantworte mindestens eine Frage.');
      return;
    }
    busy = true;
    try {
      const id = `${lb.id}_${date}`;
      const existing = state.entries.find(e => e.id === id);
      const now = new Date().toISOString();
      const entry = { id, logbookId: lb.id, date, answers, createdAt: existing ? existing.createdAt : now, updatedAt: now };
      await Store.put('entries', entry);
      state.entries = state.entries.filter(e => e.id !== id).concat(entry);
      localStorage.removeItem(draftKey(lb.id, date));

      if (date === isoDate()) {
        document.activeElement && document.activeElement.blur();
        await Celebrate.run([...app.querySelectorAll('.fill-head, .q-card, .btn-done')], lb.animation);
        go('#/done/' + lb.id);
        setTimeout(Celebrate.dismiss, 80);
      } else {
        toast('Gespeichert');
        go(`#/history/${lb.id}/${date}`);
      }
    } catch (err) {
      console.error(err);
      toast('Speichern fehlgeschlagen. Bitte noch einmal versuchen.');
    } finally {
      busy = false;
    }
  }

  function doneView(id) {
    const lb = logbook(id);
    if (!lb) return null;
    const n = streak(id);
    const total = entriesOf(id).length;
    return `
      <div class="done-view">
        <div class="done-emoji">✨</div>
        <h1>${esc(lb.doneMessage)}</h1>
        <p class="done-streak">${n > 1 ? `🔥 ${n} Tage in Folge` : 'Der Anfang ist gemacht.'}</p>
        <p class="sub">${total} ${total === 1 ? 'Eintrag' : 'Einträge'} insgesamt</p>
        <a class="btn primary" href="#/">Fertig</a>
      </div>`;
  }

  // ---------- Verlauf ----------

  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function getHistoryMode() {
    try { return localStorage.getItem('historyMode') === 'calendar' ? 'calendar' : 'list'; } catch (e) { return 'list'; }
  }

  function entryCard(lb, e) {
    const rows = lb.questions.filter(q => hasAnswer(e.answers[q.id])).map(q => {
      const v = e.answers[q.id];
      const m = q.type === 'summary' && markOf(q, v);
      return `<dt>${esc(q.title)}</dt><dd>${m ? markHtml(m, 'sm') : esc(answerText(q, v))}</dd>`;
    }).join('');
    return `
      <article class="card entry">
        <header>
          <strong>${esc(fmtFull(e.date))}</strong>
          <span>
            <a href="#/log/${lb.id}/${e.date}">Bearbeiten</a>
            <button class="link danger" data-action="delete-entry" data-id="${esc(e.id)}">Löschen</button>
          </span>
        </header>
        <dl>${rows || '<dd class="hint">Keine Antworten zu den aktuellen Fragen.</dd>'}</dl>
      </article>`;
  }

  function historyView(id, param) {
    const lb = logbook(id);
    if (!lb) return null;
    const mode = getHistoryMode();
    const entries = entriesOf(id).sort((a, b) => b.date.localeCompare(a.date));
    const toggle = `
      <div class="seg" role="tablist" aria-label="Ansicht">
        <button role="tab" data-action="history-mode" data-mode="list" aria-selected="${mode === 'list'}">Liste</button>
        <button role="tab" data-action="history-mode" data-mode="calendar" aria-selected="${mode === 'calendar'}">Kalender</button>
      </div>`;

    let body;
    if (mode === 'calendar') {
      body = calendarHtml(lb, param);
    } else {
      body = `
        <div class="card row">
          <label class="grow">Tag nachtragen
            <input type="date" id="backfill" max="${isoDate()}" value="${addDays(isoDate(), -1)}">
          </label>
          <button class="btn ghost" data-action="backfill" data-id="${lb.id}">Öffnen</button>
        </div>
        ${entries.map(e => entryCard(lb, e)).join('') || '<p class="empty">Noch keine Einträge.</p>'}`;
    }

    return `
      ${header('Verlauf', '#/', lb.emoji + ' ' + lb.name)}
      ${toggle}
      ${body}
      ${entries.length ? `<button class="btn ghost wide" data-action="export-csv" data-id="${lb.id}">Als CSV exportieren</button>` : ''}`;
  }

  // param: 'YYYY-MM' (Monat) oder 'YYYY-MM-DD' (Monat mit ausgewähltem Tag)
  function calendarHtml(lb, param) {
    const today = isoDate();
    const thisMonth = today.slice(0, 7);
    const selected = isDate(param) && param <= today ? param : null;
    let month = selected ? selected.slice(0, 7) : (/^\d{4}-\d{2}$/.test(param || '') ? param : thisMonth);
    if (month > thisMonth) month = thisMonth;
    const first = parseDate(month + '-01');
    const byDate = new Map(entriesOf(lb.id).map(e => [e.date, e]));
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;   // Montag = 0
    const shift = n => isoDate(new Date(first.getFullYear(), first.getMonth() + n, 1)).slice(0, 7);
    const prev = shift(-1), next = shift(1);

    let count = 0;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-day blank"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${pad(d)}`;
      const has = byDate.has(date);
      if (has) count++;
      const m = entryMark(lb, byDate.get(date));
      const cls = ['cal-day', has && 'on', m && 'marked ' + markClass(m), date === today && 'today', date === selected && 'sel'].filter(Boolean).join(' ');
      const inner = m ? `<span class="cal-num">${d}</span>${m.text ? `<span class="cal-mark">${esc(m.text)}</span>` : ''}` : d;
      cells.push(date > today
        ? `<span class="${cls} future">${d}</span>`
        : `<a class="${cls}" href="#/history/${lb.id}/${date}" aria-label="${esc(fmtFull(date))}${has ? ', eingetragen' : ''}${m ? ': ' + esc(answerText(summaryQ(lb), byDate.get(date).answers[summaryQ(lb).id])) : ''}">${inner}</a>`);
    }

    const title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    const pastDays = month === thisMonth ? Number(today.slice(8)) : daysInMonth;

    let detail = '<p class="hint cal-help">Tippe auf einen Tag, um den Eintrag zu sehen oder nachzutragen.</p>';
    if (selected) {
      const e = byDate.get(selected);
      detail = e ? entryCard(lb, e) : `
        <section class="card">
          <strong>${esc(fmtFull(selected))}</strong>
          <p class="hint">Für diesen Tag gibt es noch keinen Eintrag.</p>
          <a class="btn primary wide" href="#/log/${lb.id}/${selected}">${selected === today ? 'Jetzt ausfüllen' : 'Nachtragen'}</a>
        </section>`;
    }

    return `
      <section class="card cal">
        <div class="cal-head">
          <a class="icon cal-nav" href="#/history/${lb.id}/${prev}" aria-label="Vorheriger Monat">‹</a>
          <div class="cal-title">
            <strong>${esc(title)}</strong>
            <span class="hint">${count} von ${pastDays} ${pastDays === 1 ? 'Tag' : 'Tagen'} eingetragen</span>
          </div>
          ${month < thisMonth
            ? `<a class="icon cal-nav" href="#/history/${lb.id}/${next}" aria-label="Nächster Monat">›</a>`
            : '<span class="icon cal-nav disabled" aria-hidden="true">›</span>'}
        </div>
        <div class="cal-grid${summaryQ(lb) ? ' squares' : ''}">
          ${WEEKDAYS.map(w => `<span class="cal-wd">${w}</span>`).join('')}
          ${cells.join('')}
        </div>
      </section>
      ${detail}`;
  }

  // ---------- Editor ----------

  const TYPE_LABELS = {
    text: 'Freitext',
    choice: 'Auswahl (eine Antwort)',
    multi: 'Auswahl (mehrere Antworten)',
    summary: 'Tagesfazit (Zeichen & Farbe im Kalender)',
  };
  const DEFAULT_MARKS = [
    { text: '😞', color: 'red' }, { text: '😐', color: 'yellow' }, { text: '🙂', color: 'teal' }, { text: '😄', color: 'green' },
  ];

  function marksEditHtml(q) {
    q.marks = q.marks || [];
    const palette = [{ key: '', name: 'Keine Farbe' }, ...COLORS];
    return `
      <div class="opts">
        <span class="label">Auswahlmöglichkeiten</span>
        <p class="hint">Je 1–3 Zeichen (Emoji, Buchstabe, Zahl) und eine Farbe – oder nur eine Farbe.
          Die gewählte Antwort erscheint im Kalender und in der Wochenübersicht.</p>
        ${q.marks.map((m, j) => `
          <div class="mark-edit">
            <input type="text" class="mark mark-input ${markClass(m)}" data-mi="${j}" value="${esc(m.text)}" autocomplete="off" aria-label="Zeichen ${j + 1}">
            <div class="swatches" role="group" aria-label="Farbe">
              ${palette.map(c => `<button type="button" class="swatch c-${c.key || 'none'}" data-action="mark-color" data-mi="${j}" data-color="${c.key}" aria-pressed="${colorKey(m.color) === c.key}" title="${c.name}" aria-label="${c.name}"></button>`).join('')}
            </div>
            <button class="icon danger" data-action="mark-remove" data-mi="${j}" title="Entfernen">✕</button>
          </div>`).join('')}
        <button class="link" data-action="mark-add">+ Auswahlmöglichkeit</button>
      </div>`;
  }

  function newView() {
    return `
      ${header('Neues Logbuch', '#/', 'Wähle eine Vorlage – du kannst danach alles anpassen.')}
      ${Templates.list.map(t => `
        <button class="card tpl" data-action="use-template" data-key="${t.key}">
          <span class="lb-emoji">${esc(t.emoji)}</span>
          <span class="lb-text"><strong>${esc(t.name || 'Leeres Logbuch')}</strong><span class="lb-status">${esc(t.description)}</span></span>
        </button>`).join('')}`;
  }

  function editorView(id) {
    if (!editorDraft || editorDraft.id !== id) {
      const lb = logbook(id);
      if (!lb) return null;
      editorDraft = JSON.parse(JSON.stringify(lb));
    }
    const d = editorDraft;
    const isNew = !logbook(d.id);
    const questions = d.questions.map((q, i) => `
      <section class="card q-edit" data-qi="${i}">
        <div class="q-edit-head">
          <span class="num">Frage ${i + 1}</span>
          <span>
            <button class="icon" data-action="q-up" title="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon" data-action="q-down" title="Nach unten" ${i === d.questions.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon danger" data-action="q-remove" title="Frage löschen">✕</button>
          </span>
        </div>
        <label>Frage<input type="text" data-qf="title" value="${esc(q.title)}" placeholder="z. B. Wie geht es mir heute?"></label>
        <label>Hinweis (optional)<input type="text" data-qf="hint" value="${esc(q.hint)}"></label>
        <label>Antwortart
          <select data-qf="type">
            ${Object.keys(TYPE_LABELS).map(t => {
              const taken = t === 'summary' && d.questions.some((x, k) => k !== i && x.type === 'summary');
              return `<option value="${t}" ${q.type === t ? 'selected' : ''} ${taken ? 'disabled' : ''}>${TYPE_LABELS[t]}${taken ? ' – schon vergeben' : ''}</option>`;
            }).join('')}
          </select>
        </label>
        ${q.type === 'text' ? '' : q.type === 'summary' ? marksEditHtml(q) : `
          <div class="opts">
            <span class="label">Auswahlmöglichkeiten</span>
            ${q.options.map((o, j) => `
              <div class="opt">
                <input type="text" data-oi="${j}" value="${esc(o)}" placeholder="z. B. 🙂 Gut" aria-label="Auswahlmöglichkeit ${j + 1}">
                <button class="icon danger" data-action="opt-remove" data-oi="${j}" title="Entfernen">✕</button>
              </div>`).join('')}
            <button class="link" data-action="opt-add">+ Auswahlmöglichkeit</button>
          </div>`}
      </section>`).join('');

    return `
      ${header(isNew ? 'Neues Logbuch' : 'Logbuch anpassen', '#/')}
      <section class="card">
        <div class="row">
          <label class="emoji-field">Symbol<input type="text" data-f="emoji" value="${esc(d.emoji)}" maxlength="8"></label>
          <label class="grow">Name<input type="text" data-f="name" value="${esc(d.name)}" placeholder="z. B. Feierabend-Reset"></label>
        </div>
        <label>Text auf dem Abschluss-Button<input type="text" data-f="doneLabel" value="${esc(d.doneLabel)}"></label>
        <label>Nachricht nach dem Abschluss<input type="text" data-f="doneMessage" value="${esc(d.doneMessage)}"></label>
        <div class="row">
          <label class="grow">Abschluss-Animation
            <select data-f="animation">
              ${Celebrate.kinds.map(k => `<option value="${k.key}" ${(d.animation || 'rocket') === k.key ? 'selected' : ''}>${k.label}</option>`).join('')}
            </select>
          </label>
          <button class="btn ghost" data-action="preview-animation">Vorschau</button>
        </div>
      </section>
      ${reminderHtml(d)}
      ${questions}
      <button class="btn ghost wide" data-action="q-add">+ Frage hinzufügen</button>
      <button class="btn primary wide" data-action="save-logbook">Speichern</button>
      ${isNew ? '' : '<button class="btn danger-ghost wide" data-action="delete-logbook">Logbuch löschen</button>'}`;
  }

  function reminderHtml(d) {
    const r = d.reminder = Reminders.normalize(d.reminder);
    const perm = Reminders.permission();
    return `
      <section class="card reminder">
        <label class="switch">
          <input type="checkbox" data-r="enabled" ${r.enabled ? 'checked' : ''}>
          <span><strong>Erinnerung</strong>${r.enabled ? ` · ${esc(Reminders.describe(r))}` : ''}</span>
        </label>
        ${r.enabled ? `
          <div class="chips days" role="group" aria-label="Wochentage">
            ${Reminders.DAY_LABELS.map((l, i) =>
              `<button type="button" class="chip" data-action="r-day" data-day="${i + 1}" aria-pressed="${r.days.includes(i + 1)}">${l}</button>`).join('')}
          </div>
          <label>Uhrzeit<input type="time" data-r="time" value="${esc(r.time)}"></label>
          <p class="hint">Übernimm die Erinnerung einmal in deinen Kalender, dann meldet er sich zur eingestellten Zeit.
            Änderst du später Tage oder Uhrzeit, lösche den alten Termin im Kalender und übernimm ihn neu.</p>
          <div class="row wrap">
            <button class="btn ghost grow" data-action="r-ics">Termin-Datei<small>iPhone, Windows</small></button>
            <button class="btn ghost grow" data-action="r-google">Google Kalender<small>Android</small></button>
          </div>
          ${perm === 'default' ? '<button class="link" data-action="r-notify">Zusätzlich benachrichtigen, solange die App offen ist</button>' : ''}
          ${perm === 'granted' ? '<p class="hint">✓ Ist die App offen, meldet sie sich zusätzlich selbst.</p>' : ''}` : ''}
      </section>`;
  }

  async function saveLogbook() {
    const d = editorDraft;
    d.name = d.name.trim();
    d.emoji = d.emoji.trim() || '📓';
    d.doneLabel = d.doneLabel.trim() || 'Erledigt';
    d.doneMessage = d.doneMessage.trim() || 'Geschafft. Bis morgen!';
    d.animation = d.animation || 'rocket';
    d.reminder = Reminders.normalize(d.reminder);
    if (d.reminder.enabled && !d.reminder.days.length) return toast('Wähle mindestens einen Tag für die Erinnerung.');
    if (!d.name) return toast('Gib dem Logbuch einen Namen.');
    d.questions.forEach(q => {
      q.title = q.title.trim();
      q.hint = q.hint.trim();
      q.options = q.type === 'choice' || q.type === 'multi' ? [...new Set(q.options.map(o => o.trim()).filter(Boolean))] : [];
      if (q.type === 'summary') {
        const seen = new Set();
        q.marks = (q.marks || [])
          .map(m => ({ text: clampMark(m.text), color: colorKey(m.color) }))
          .filter(m => (m.text || m.color) && !seen.has(m.text + '|' + m.color) && seen.add(m.text + '|' + m.color));
      } else delete q.marks;
    });
    if (!d.questions.length) return toast('Füge mindestens eine Frage hinzu.');
    if (d.questions.some(q => !q.title)) return toast('Jede Frage braucht einen Text.');
    if (d.questions.some(q => (q.type === 'choice' || q.type === 'multi') && q.options.length < 2)) {
      return toast('Auswahlfragen brauchen mindestens zwei Möglichkeiten.');
    }
    if (d.questions.filter(q => q.type === 'summary').length > 1) return toast('Es gibt nur ein Tagesfazit pro Logbuch.');
    if (d.questions.some(q => q.type === 'summary' && q.marks.length < 2)) {
      return toast('Das Tagesfazit braucht mindestens zwei Möglichkeiten.');
    }
    d.updatedAt = new Date().toISOString();
    await Store.put('logbooks', d);
    state.logbooks = state.logbooks.some(l => l.id === d.id)
      ? state.logbooks.map(l => (l.id === d.id ? d : l))
      : state.logbooks.concat(d);
    editorDraft = null;
    toast('Gespeichert');
    go('#/');
  }

  async function deleteLogbook() {
    const d = editorDraft;
    const count = entriesOf(d.id).length;
    if (!confirm(`„${d.name}" mit ${count} ${count === 1 ? 'Eintrag' : 'Einträgen'} endgültig löschen?`)) return;
    for (const e of entriesOf(d.id)) await Store.remove('entries', e.id);
    await Store.remove('logbooks', d.id);
    state.entries = state.entries.filter(e => e.logbookId !== d.id);
    state.logbooks = state.logbooks.filter(l => l.id !== d.id);
    editorDraft = null;
    go('#/');
  }

  // ---------- Daten ----------

  function dataView() {
    return `
      ${header('Daten', '#/', 'Deine Einträge liegen nur auf diesem Gerät.')}
      <section class="card">
        <h2>CSV-Export</h2>
        <p class="hint">Eine Tabelle pro Logbuch, z. B. für Excel oder Google Sheets.</p>
        ${state.logbooks.map(lb => `
          <button class="btn ghost wide" data-action="export-csv" data-id="${lb.id}">${esc(lb.emoji + ' ' + lb.name)} (${entriesOf(lb.id).length})</button>`).join('')}
      </section>
      <section class="card">
        <h2>Backup</h2>
        <p class="hint">Sichert alle Logbücher und Einträge in einer Datei. Damit kannst du sie auch auf ein anderes Gerät übertragen.</p>
        <button class="btn ghost wide" data-action="export-json">Backup herunterladen</button>
        <label class="btn ghost wide file">Backup einspielen<input type="file" id="import" accept="application/json,.json" hidden></label>
      </section>`;
  }

  function exportCsv(id) {
    const lb = logbook(id);
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Datum', ...lb.questions.map(q => q.title)]];
    entriesOf(id).sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
      rows.push([e.date, ...lb.questions.map(q => answerText(q, e.answers[q.id]))]);
    });
    const csv = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
    const name = lb.name.replace(/[^\wäöüÄÖÜß-]+/g, '_');
    download(`${name}_${isoDate()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportJson() {
    const data = { app: 'logbook-app', version: 1, exportedAt: new Date().toISOString(), logbooks: state.logbooks, entries: state.entries };
    download(`logbuch-backup_${isoDate()}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  async function importJson(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      return toast('Die Datei ist kein gültiges Backup.');
    }
    if (!data || !Array.isArray(data.logbooks) || !Array.isArray(data.entries)) {
      return toast('Die Datei ist kein gültiges Backup.');
    }
    // Neuerer Stand gewinnt
    const newer = (incoming, current) => incoming.filter(x => {
      if (!x || !x.id) return false;
      const mine = current.find(c => c.id === x.id);
      return !mine || String(x.updatedAt || '') > String(mine.updatedAt || '');
    });
    const logbooks = newer(data.logbooks, state.logbooks).filter(l => Array.isArray(l.questions));
    const entries = newer(data.entries, state.entries).filter(e => e.logbookId && isDate(e.date) && e.answers);
    await Store.bulkPut('logbooks', logbooks);
    await Store.bulkPut('entries', entries);
    await load();
    toast(`${logbooks.length} Logbücher und ${entries.length} Einträge übernommen.`);
    render();
  }

  // ---------- Routing ----------

  function render() {
    const [view, a, b] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (view !== 'edit') editorDraft = null;
    let html;
    switch (view) {
      case 'log': html = fillView(a, b || isoDate()); break;
      case 'done': html = doneView(a); break;
      case 'history': html = historyView(a, b); break;
      case 'new': html = newView(); break;
      case 'edit': html = editorView(a); break;
      case 'data': html = dataView(); break;
      default: html = homeView();
    }
    if (html == null) { go('#/'); return; }
    app.className = 'view-' + (view || 'home');
    app.innerHTML = html;
    app.querySelectorAll('textarea').forEach(autoGrow);
  }

  function rerenderEditor() {
    const y = window.scrollY;
    app.innerHTML = editorView(editorDraft.id);
    window.scrollTo(0, y);
  }

  // ---------- Ereignisse ----------

  app.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const qEl = el.closest('[data-qi]');
    const qi = qEl ? Number(qEl.dataset.qi) : -1;
    const qs = editorDraft ? editorDraft.questions : null;

    switch (action) {
      case 'pick': {
        const single = el.closest('[data-question]').dataset.type !== 'multi';
        const on = el.getAttribute('aria-pressed') === 'true';
        if (single) el.parentElement.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
        el.setAttribute('aria-pressed', String(!on));
        saveDraft();
        break;
      }
      case 'submit': await submitEntry(); break;
      case 'backfill': {
        const date = document.getElementById('backfill').value;
        if (!isDate(date) || date > isoDate()) return toast('Wähle ein Datum bis heute.');
        go(`#/log/${el.dataset.id}/${date}`);
        break;
      }
      case 'delete-entry': {
        const entry = state.entries.find(e => e.id === el.dataset.id);
        if (!entry || !confirm(`Eintrag vom ${fmtFull(entry.date)} löschen?`)) return;
        await Store.remove('entries', entry.id);
        state.entries = state.entries.filter(e => e.id !== entry.id);
        render();
        break;
      }
      case 'history-mode':
        try { localStorage.setItem('historyMode', el.dataset.mode); } catch (e) { /* nur Komfort */ }
        render();
        break;
      case 'export-csv': exportCsv(el.dataset.id); break;
      case 'export-json': exportJson(); break;
      case 'use-template':
        editorDraft = Templates.create(el.dataset.key, uid);
        go('#/edit/' + editorDraft.id);
        break;
      case 'q-add':
        qs.push({ id: uid(), title: '', hint: '', type: 'text', options: [] });
        rerenderEditor();
        break;
      case 'q-remove': qs.splice(qi, 1); rerenderEditor(); break;
      case 'q-up': qs.splice(qi - 1, 0, qs.splice(qi, 1)[0]); rerenderEditor(); break;
      case 'q-down': qs.splice(qi + 1, 0, qs.splice(qi, 1)[0]); rerenderEditor(); break;
      case 'opt-add': qs[qi].options.push(''); rerenderEditor(); break;
      case 'opt-remove': qs[qi].options.splice(Number(el.dataset.oi), 1); rerenderEditor(); break;
      case 'mark-add':
        qs[qi].marks.push({ text: '', color: COLORS[qs[qi].marks.length % COLORS.length].key });
        rerenderEditor();
        break;
      case 'mark-remove': qs[qi].marks.splice(Number(el.dataset.mi), 1); rerenderEditor(); break;
      case 'mark-color': qs[qi].marks[Number(el.dataset.mi)].color = el.dataset.color; rerenderEditor(); break;
      case 'preview-animation':
        if (busy) return;
        busy = true;
        await Celebrate.run([...app.querySelectorAll('.card, .btn')], editorDraft.animation);
        rerenderEditor();
        Celebrate.dismiss();
        busy = false;
        break;
      case 'r-day': {
        const r = editorDraft.reminder;
        const day = Number(el.dataset.day);
        r.days = r.days.includes(day) ? r.days.filter(x => x !== day) : r.days.concat(day).sort();
        rerenderEditor();
        break;
      }
      case 'r-ics': {
        if (!editorDraft.reminder.days.length) return toast('Wähle mindestens einen Tag.');
        const name = (editorDraft.name || 'Logbuch').replace(/[^\wäöüÄÖÜß-]+/g, '_');
        download(`Erinnerung_${name}.ics`, Reminders.ics(editorDraft), 'text/calendar;charset=utf-8');
        break;
      }
      case 'r-google':
        if (!editorDraft.reminder.days.length) return toast('Wähle mindestens einen Tag.');
        window.open(Reminders.googleUrl(editorDraft), '_blank', 'noopener');
        break;
      case 'r-notify': {
        const result = await Reminders.requestPermission();
        toast(result === 'granted' ? 'Benachrichtigungen erlaubt' : 'Benachrichtigungen nicht erlaubt');
        rerenderEditor();
        break;
      }
      case 'save-logbook': await saveLogbook(); break;
      case 'delete-logbook': await deleteLogbook(); break;
    }
  });

  app.addEventListener('input', ev => {
    const el = ev.target;
    if (el.tagName === 'TEXTAREA') { autoGrow(el); saveDraft(); return; }
    if (!editorDraft) return;
    const qEl = el.closest('[data-qi]');
    if (el.dataset.r === 'time') { if (el.value) editorDraft.reminder.time = el.value; return; }
    if (el.dataset.f) editorDraft[el.dataset.f] = el.value;
    else if (qEl && el.dataset.qf && el.dataset.qf !== 'type') editorDraft.questions[qEl.dataset.qi][el.dataset.qf] = el.value;
    else if (qEl && el.dataset.oi) editorDraft.questions[qEl.dataset.qi].options[el.dataset.oi] = el.value;
    else if (qEl && el.dataset.mi) {
      const m = editorDraft.questions[qEl.dataset.qi].marks[el.dataset.mi];
      const v = clampMark(el.value);
      if (v !== el.value) el.value = v;
      m.text = v;
      el.className = `mark mark-input ${markClass(m)}`;
    }
  });

  app.addEventListener('change', ev => {
    const el = ev.target;
    if (el.id === 'import' && el.files[0]) { importJson(el.files[0]); return; }
    if (editorDraft && el.dataset.r === 'enabled') { editorDraft.reminder.enabled = el.checked; rerenderEditor(); return; }
    if (editorDraft && el.dataset.r === 'time') { rerenderEditor(); return; }
    if (editorDraft && el.dataset.qf === 'type') {
      const q = editorDraft.questions[el.closest('[data-qi]').dataset.qi];
      q.type = el.value;
      q.options = q.options || [];
      if (q.type === 'summary' && !(q.marks && q.marks.length)) {
        // Aus einer Auswahlfrage wird das erste Wort jeder Möglichkeit (meist das Emoji) übernommen.
        const opts = q.options.map(o => clampMark(o.trim().split(/\s+/)[0])).filter(Boolean);
        q.marks = opts.length >= 2
          ? opts.map((text, k) => ({ text, color: autoColor(k, opts.length) }))
          : DEFAULT_MARKS.map(m => ({ ...m }));
      }
      if ((q.type === 'choice' || q.type === 'multi') && !q.options.length) {
        const fromMarks = (q.marks || []).map(m => m.text).filter(Boolean);
        q.options = fromMarks.length >= 2 ? fromMarks : ['🙂 Gut', '😐 Mittel', '😞 Schlecht'];
      }
      rerenderEditor();
    }
  });

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  // ---------- Initialisierung ----------

  async function load() {
    state.logbooks = (await Store.getAll('logbooks')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    state.entries = await Store.getAll('entries');
  }

  async function init() {
    try {
      await load();
      if (!state.logbooks.length && !localStorage.getItem('seeded')) {
        const first = Templates.create('feierabend', uid);
        await Store.put('logbooks', first);
        state.logbooks.push(first);
        localStorage.setItem('seeded', '1');
      }
    } catch (err) {
      console.error(err);
      app.innerHTML = '<p class="empty">Der lokale Speicher ist nicht verfügbar. Im privaten Modus kann die App keine Einträge sichern.</p>';
      return;
    }
    render();
    Reminders.watch(() => state, () => isoDate());
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      if (['localhost', '127.0.0.1'].includes(location.hostname)) {
        // Beim Entwickeln kein Offline-Cache, damit Änderungen sofort sichtbar sind.
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
      } else {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker:', err));
      }
    }
  }

  init();
})();
