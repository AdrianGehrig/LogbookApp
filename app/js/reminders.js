// Erinnerungen: Eine Web-App kann sich nicht selbst zu einer Uhrzeit wecken.
// Deshalb wird die Erinnerung als wiederkehrender Termin in den Kalender des
// Geräts übernommen. Ist die App gerade offen (z. B. am PC), meldet sie sich
// zusätzlich selbst per Benachrichtigung.
const Reminders = (() => {
  'use strict';

  const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const WINDOW_MIN = 120;   // so lange nach der Uhrzeit meldet sich die offene App noch

  const pad = n => String(n).padStart(2, '0');
  const isoWeekday = d => (d.getDay() + 6) % 7 + 1;   // Mo = 1 … So = 7

  // Logbücher ohne Einstellung bekommen eine ausgeschaltete Standard-Erinnerung.
  function normalize(r) {
    const days = r && Array.isArray(r.days) ? r.days.filter(n => n >= 1 && n <= 7) : [1, 2, 3, 4, 5, 6, 7];
    const time = r && /^\d{2}:\d{2}$/.test(r.time || '') ? r.time : '19:00';
    return { enabled: !!(r && r.enabled), days: [...new Set(days)].sort(), time };
  }

  function describe(r) {
    const n = normalize(r);
    if (!n.days.length) return '';
    let days;
    if (n.days.length === 7) days = 'Täglich';
    else if (n.days.length >= 3 && n.days[n.days.length - 1] - n.days[0] === n.days.length - 1) {
      days = `${DAY_LABELS[n.days[0] - 1]}–${DAY_LABELS[n.days[n.days.length - 1] - 1]}`;   // z. B. Mo–Fr
    } else days = n.days.map(d => DAY_LABELS[d - 1]).join(', ');
    return `${days} um ${n.time} Uhr`;
  }

  // Erster passender Termin ab heute
  function firstOccurrence(r) {
    const [h, m] = r.time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    for (let i = 0; i < 7 && !r.days.includes(isoWeekday(d)); i++) d.setDate(d.getDate() + 1);
    return d;
  }

  const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

  function rrule(r) {
    return r.days.length === 7 ? 'FREQ=DAILY' : `FREQ=WEEKLY;BYDAY=${r.days.map(d => RRULE_DAYS[d - 1]).join(',')}`;
  }

  const appUrl = lb => location.origin + location.pathname + '#/log/' + lb.id;
  const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // Termin-Datei (iCalendar) mit einer Serie und einem Alarm zur Startzeit.
  // Die feste UID lässt Kalender wie Apple oder Outlook einen früher übernommenen
  // Termin aktualisieren, statt einen zweiten anzulegen.
  function ics(lb) {
    const r = normalize(lb.reminder);
    const start = firstOccurrence(r);
    const end = new Date(start.getTime() + 5 * 60000);
    const now = new Date();
    const utc = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const title = `${lb.emoji} ${lb.name}`.trim();
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Logbuch//Erinnerung//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:logbuch-${lb.id}@logbuch-app`,
      `DTSTAMP:${utc}`,
      `SEQUENCE:${Math.floor(now.getTime() / 1000)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `RRULE:${rrule(r)}`,
      `SUMMARY:${icsText(title)}`,
      `DESCRIPTION:${icsText('5 Minuten Logbuch: ' + appUrl(lb))}`,
      `URL:${appUrl(lb)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsText(title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  }

  // Link, der Google Kalender mit dem fertig ausgefüllten Serientermin öffnet (für Android).
  function googleUrl(lb) {
    const r = normalize(lb.reminder);
    const start = firstOccurrence(r);
    const end = new Date(start.getTime() + 5 * 60000);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${lb.emoji} ${lb.name}`.trim(),
      dates: `${stamp(start)}/${stamp(end)}`,
      details: '5 Minuten Logbuch: ' + appUrl(lb),
      recur: 'RRULE:' + rrule(r),
    });
    try { params.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch (e) { /* ohne Zeitzone */ }
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  // ---------- Benachrichtigung, solange die App offen ist ----------

  const supported = () => 'Notification' in window;
  const permission = () => (supported() ? Notification.permission : 'unsupported');

  function requestPermission() {
    if (!supported()) return Promise.resolve('unsupported');
    return Notification.requestPermission();
  }

  async function show(title, body, url, tag) {
    const options = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url } };
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null);
    if (reg) return reg.showNotification(title, options);
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); location.hash = url.split('#')[1] ? '#' + url.split('#')[1] : '#/'; n.close(); };
  }

  // getState liefert { logbooks, entries }; today ist 'YYYY-MM-DD'.
  function check(getState, today) {
    if (permission() !== 'granted') return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const { logbooks, entries } = getState();
    logbooks.forEach(lb => {
      const r = normalize(lb.reminder);
      if (!r.enabled || !r.days.includes(isoWeekday(now))) return;
      const [h, m] = r.time.split(':').map(Number);
      const due = h * 60 + m;
      if (minutes < due || minutes > due + WINDOW_MIN) return;
      if (entries.some(e => e.logbookId === lb.id && e.date === today)) return;
      const key = `notified:${lb.id}:${today}`;
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
      } catch (e) { return; }
      show(`${lb.emoji} ${lb.name}`.trim(), 'Zeit für deine 5 Minuten.', appUrl(lb), 'logbuch-' + lb.id)
        .catch(err => console.warn('Benachrichtigung:', err));
    });
  }

  function watch(getState, today) {
    const run = () => check(getState, today());
    run();
    setInterval(run, 30000);
    document.addEventListener('visibilitychange', run);
  }

  return { DAY_LABELS, normalize, describe, ics, googleUrl, permission, requestPermission, watch };
})();
