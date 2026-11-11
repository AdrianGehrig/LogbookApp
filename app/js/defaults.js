// Vorlagen für neue Logbücher. Der Feierabend-Reset wird beim ersten Start angelegt.
const Templates = (() => {
  'use strict';

  const list = [
    {
      key: 'feierabend',
      name: 'Feierabend-Reset',
      emoji: '🚀',
      description: 'Nach der Arbeit abschalten und den Kopf leeren.',
      doneLabel: 'Reset erledigt',
      doneMessage: 'Kopf frei. Schönen Feierabend!',
      animation: 'rocket',
      questions: [
        { title: 'Wie war dein Tag?', hint: '', type: 'choice', options: ['😞 Schlecht', '😐 Mittel', '🙂 Gut', '😄 Super'] },
        { title: 'Was ist heute passiert?', hint: 'Lass den Tag in 2–3 kurzen Stichpunkten Revue passieren.', type: 'text' },
        { title: 'Was ist heute schlecht gelaufen?', hint: 'Lass Frust raus und analysiere Fehler – damit sie im Büro bleiben.', type: 'text' },
        { title: 'Was ist heute gut gelaufen?', hint: 'Richte den Blick auf Erfolge, auch auf die kleinen.', type: 'text' },
        { title: 'Was möchte ich morgen machen?', hint: 'Schreibe die 1–2 wichtigsten To-dos für morgen auf, damit dein Kopf sie abspeichern und loslassen kann.', type: 'text' },
        { title: 'Worauf freue ich mich jetzt am Feierabend?', hint: 'Schalte mental auf Freizeit, Hobby und Familie um.', type: 'text' },
      ],
    },
    {
      key: 'ernaehrung',
      name: 'Ernährung & Befinden',
      emoji: '🥗',
      description: 'Was gegessen, wie gefühlt – um Zusammenhänge zu erkennen.',
      doneLabel: 'Tag eingetragen',
      doneMessage: 'Eingetragen. Gut gemacht!',
      animation: 'horse',
      questions: [
        { title: 'Was habe ich heute gegessen?', hint: 'Frühstück, Mittag, Abend, Snacks – Stichpunkte reichen.', type: 'text' },
        { title: 'Wie geht es mir heute?', hint: '', type: 'choice', options: ['😞 Schlecht', '😐 Mittel', '🙂 Gut', '😄 Sehr gut'] },
        { title: 'Hatte ich Beschwerden?', hint: 'Mehrere möglich.', type: 'multi', options: ['Keine', 'Kopf', 'Magen / Darm', 'Rücken', 'Gelenke', 'Haut', 'Müdigkeit'] },
        { title: 'Sonst noch etwas aufgefallen?', hint: '', type: 'text' },
      ],
    },
    {
      key: 'leer',
      name: '',
      emoji: '📓',
      description: 'Mit einer leeren Seite starten.',
      doneLabel: 'Erledigt',
      doneMessage: 'Geschafft. Bis morgen!',
      animation: 'rocket',
      questions: [{ title: '', hint: '', type: 'text' }],
    },
  ];

  function create(key, uid) {
    const tpl = list.find(t => t.key === key) || list[list.length - 1];
    const now = new Date().toISOString();
    return {
      id: uid(),
      name: tpl.name,
      emoji: tpl.emoji,
      doneLabel: tpl.doneLabel,
      doneMessage: tpl.doneMessage,
      animation: tpl.animation,
      questions: tpl.questions.map(q => ({
        id: uid(),
        title: q.title,
        hint: q.hint || '',
        type: q.type,
        options: q.options ? q.options.slice() : [],
      })),
      createdAt: now,
      updatedAt: now,
    };
  }

  return { list, create };
})();
