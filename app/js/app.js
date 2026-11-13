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
  const hasAnswer = v => Array.isArray(v) ? v.length > 0 : String(v == null ? '' : v).trim() !== '';
  const go = hash => { location.hash = hash; };
  const draftKey = (lbId, date) => `draft:${lbId}:${date}`;

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  const logbook = id => state.logbooks.find(l => l.id === id);
  const entriesOf = id => state.entries.filter(e => e.logbookId === id);

  function streak(id) {
    const dates = new Set(entriesOf(id).map(e => e.date));
    let day = isoDate();
    if (!dates.has(day)) day = addDays(day, -1);
    let n = 0;
    while (dates.has(day)) { n++; day = addDays(day, -1); }
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
      const dates = new Set(entriesOf(lb.id).map(e => e.date));
      const done = dates.has(today);
      const n = streak(lb.id);
      const dots = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        dots.push(`<span class="dot${dates.has(d) ? ' on' : ''}${i === 0 ? ' today' : ''}" title="${esc(fmtFull(d))}"></span>`);
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
            <div class="dots" aria-label="Letzte 7 Tage">${dots.join('')}</div>
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
      input = `<textarea rows="2" placeholder="${esc(q.hint || '…')}" aria-label="${esc(q.title)}">${esc(value || '')}</textarea>`;
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
      return `<dt>${esc(q.title)}</dt><dd>${esc(Array.isArray(v) ? v.join(', ') : v)}</dd>`;
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
      const cls = ['cal-day', has && 'on', date === today && 'today', date === selected && 'sel'].filter(Boolean).join(' ');
      cells.push(date > today
        ? `<span class="${cls} future">${d}</span>`
        : `<a class="${cls}" href="#/history/${lb.id}/${date}" aria-label="${esc(fmtFull(date))}${has ? ', eingetragen' : ''}">${d}</a>`);
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
        <div class="cal-grid">
          ${WEEKDAYS.map(w => `<span class="cal-wd">${w}</span>`).join('')}
          ${cells.join('')}
        </div>
      </section>
      ${detail}`;
  }

  // ---------- Editor ----------

  const TYPE_LABELS = { text: 'Freitext', choice: 'Auswahl (eine Antwort)', multi: 'Auswahl (mehrere Antworten)' };

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
            ${Object.keys(TYPE_LABELS).map(t => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </label>
        ${q.type === 'text' ? '' : `
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
      ${questions}
      <button class="btn ghost wide" data-action="q-add">+ Frage hinzufügen</button>
      <button class="btn primary wide" data-action="save-logbook">Speichern</button>
      ${isNew ? '' : '<button class="btn danger-ghost wide" data-action="delete-logbook">Logbuch löschen</button>'}`;
  }

  async function saveLogbook() {
    const d = editorDraft;
    d.name = d.name.trim();
    d.emoji = d.emoji.trim() || '📓';
    d.doneLabel = d.doneLabel.trim() || 'Erledigt';
    d.doneMessage = d.doneMessage.trim() || 'Geschafft. Bis morgen!';
    d.animation = d.animation || 'rocket';
    if (!d.name) return toast('Gib dem Logbuch einen Namen.');
    d.questions.forEach(q => {
      q.title = q.title.trim();
      q.hint = q.hint.trim();
      q.options = q.type === 'text' ? [] : [...new Set(q.options.map(o => o.trim()).filter(Boolean))];
    });
    if (!d.questions.length) return toast('Füge mindestens eine Frage hinzu.');
    if (d.questions.some(q => !q.title)) return toast('Jede Frage braucht einen Text.');
    if (d.questions.some(q => q.type !== 'text' && q.options.length < 2)) {
      return toast('Auswahlfragen brauchen mindestens zwei Möglichkeiten.');
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
      rows.push([e.date, ...lb.questions.map(q => {
        const v = e.answers[q.id];
        return Array.isArray(v) ? v.join(', ') : v;
      })]);
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
        const single = el.closest('[data-question]').dataset.type === 'choice';
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
      case 'preview-animation':
        if (busy) return;
        busy = true;
        await Celebrate.run([...app.querySelectorAll('.card, .btn')], editorDraft.animation);
        rerenderEditor();
        Celebrate.dismiss();
        busy = false;
        break;
      case 'save-logbook': await saveLogbook(); break;
      case 'delete-logbook': await deleteLogbook(); break;
    }
  });

  app.addEventListener('input', ev => {
    const el = ev.target;
    if (el.tagName === 'TEXTAREA') { autoGrow(el); saveDraft(); return; }
    if (!editorDraft) return;
    const qEl = el.closest('[data-qi]');
    if (el.dataset.f) editorDraft[el.dataset.f] = el.value;
    else if (qEl && el.dataset.qf && el.dataset.qf !== 'type') editorDraft.questions[qEl.dataset.qi][el.dataset.qf] = el.value;
    else if (qEl && el.dataset.oi) editorDraft.questions[qEl.dataset.qi].options[el.dataset.oi] = el.value;
  });

  app.addEventListener('change', ev => {
    const el = ev.target;
    if (el.id === 'import' && el.files[0]) { importJson(el.files[0]); return; }
    if (editorDraft && el.dataset.qf === 'type') {
      const q = editorDraft.questions[el.closest('[data-qi]').dataset.qi];
      q.type = el.value;
      if (q.type !== 'text' && !q.options.length) q.options = ['🙂 Gut', '😐 Mittel', '😞 Schlecht'];
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
