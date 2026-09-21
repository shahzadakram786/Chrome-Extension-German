/**
 * Spaced repetition scheduler — an SM-2 variant with explicit learning steps,
 * the same shape Anki uses. A card carries its own schedule so the deck needs
 * no global state and stays mergeable across devices.
 *
 * Grades: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy.
 */
(function () {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;

  const EASE_MIN = 1.3;
  const EASE_MAX = 2.8;
  const EASE_START = 2.5;

  // Minutes a card waits while still in the learning phase.
  const LEARNING_STEPS = [1, 10];

  const GRADES = [
    { grade: 0, key: 'again', label: 'Again', hint: 'No idea' },
    { grade: 1, key: 'hard', label: 'Hard', hint: 'Barely' },
    { grade: 2, key: 'good', label: 'Good', hint: 'Got it' },
    { grade: 3, key: 'easy', label: 'Easy', hint: 'Too easy' }
  ];

  const clampEase = (e) => Math.min(EASE_MAX, Math.max(EASE_MIN, e));

  function newCard(fields) {
    const now = Date.now();
    return Object.assign(
      {
        id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 7),
        term: '',
        translation: '',
        source: 'auto',
        target: 'en',
        pos: '',
        senses: [],
        context: '',
        url: '',
        title: '',
        created: now,
        // Schedule
        due: now,
        interval: 0, // days; 0 while learning
        ease: EASE_START,
        step: 0, // index into LEARNING_STEPS
        state: 'learning', // learning | review | relearning
        reps: 0,
        lapses: 0,
        lastReviewed: 0,
        suspended: false
      },
      fields
    );
  }

  /**
   * Returns a NEW card object with the schedule advanced. Pure, so callers can
   * preview an interval without committing it (see intervalPreview).
   */
  function review(card, grade, now) {
    now = now || Date.now();
    const c = Object.assign({}, card);
    c.reps += 1;
    c.lastReviewed = now;

    const learning = c.state === 'learning' || c.state === 'relearning';

    if (grade === 0) {
      // Lapse: back to the start of the learning steps.
      if (c.state === 'review') c.lapses += 1;
      c.ease = clampEase(c.ease - 0.2);
      c.state = c.state === 'review' ? 'relearning' : c.state;
      c.step = 0;
      c.interval = 0;
      c.due = now + LEARNING_STEPS[0] * MIN;
      return c;
    }

    if (learning) {
      if (grade === 3) {
        // Easy answers graduate immediately.
        c.state = 'review';
        c.step = 0;
        c.interval = 4;
        c.ease = clampEase(c.ease + 0.05);
        c.due = now + c.interval * DAY;
        return c;
      }
      if (grade === 1) {
        // Hard repeats the current step rather than advancing.
        c.due = now + LEARNING_STEPS[Math.min(c.step, LEARNING_STEPS.length - 1)] * MIN;
        return c;
      }
      // Good: advance a step, graduate off the end.
      c.step += 1;
      if (c.step >= LEARNING_STEPS.length) {
        c.state = 'review';
        c.step = 0;
        c.interval = 1;
        c.due = now + DAY;
      } else {
        c.due = now + LEARNING_STEPS[c.step] * MIN;
      }
      return c;
    }

    // Review state.
    const prev = Math.max(c.interval, 1);
    if (grade === 1) {
      c.ease = clampEase(c.ease - 0.15);
      c.interval = Math.max(prev * 1.2, prev + 1);
    } else if (grade === 2) {
      c.interval = prev * c.ease;
    } else {
      c.ease = clampEase(c.ease + 0.15);
      c.interval = prev * c.ease * 1.3;
    }
    c.interval = Math.min(Math.round(c.interval), 365 * 4);
    c.due = now + c.interval * DAY;
    return c;
  }

  /** What each button would schedule, for the "Good → 3d" labels on the buttons. */
  function intervalPreview(card, now) {
    const out = {};
    GRADES.forEach((g) => {
      const next = review(card, g.grade, now || Date.now());
      out[g.key] = humanDelay(next.due - (now || Date.now()));
    });
    return out;
  }

  function humanDelay(ms) {
    if (ms <= 0) return 'now';
    const mins = ms / MIN;
    if (mins < 60) return Math.max(1, Math.round(mins)) + 'm';
    if (mins < 60 * 36) return Math.round(mins / 60) + 'h';
    const days = ms / DAY;
    if (days < 31) return Math.round(days) + 'd';
    if (days < 365) return (days / 30.4).toFixed(days < 60 ? 1 : 0) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  function isDue(card, now) {
    return !card.suspended && card.due <= (now || Date.now());
  }

  /**
   * Cards to study now: learning cards first (they are time-sensitive), then
   * the most overdue reviews. Caps the session so a 900-card backlog does not
   * present itself as one sitting.
   */
  function buildQueue(cards, now, limit) {
    now = now || Date.now();
    const due = cards.filter((c) => isDue(c, now));
    due.sort((a, b) => {
      const aLearn = a.state !== 'review' ? 0 : 1;
      const bLearn = b.state !== 'review' ? 0 : 1;
      if (aLearn !== bLearn) return aLearn - bLearn;
      return a.due - b.due;
    });
    return typeof limit === 'number' && limit > 0 ? due.slice(0, limit) : due;
  }

  function counts(cards, now) {
    now = now || Date.now();
    let due = 0;
    let learning = 0;
    let young = 0;
    let mature = 0;
    cards.forEach((c) => {
      if (c.suspended) return;
      if (isDue(c, now)) due += 1;
      if (c.state !== 'review') learning += 1;
      else if (c.interval >= 21) mature += 1;
      else young += 1;
    });
    return { total: cards.length, due, learning, young, mature };
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, {
    srs: { newCard, review, intervalPreview, humanDelay, isDue, buildQueue, counts, GRADES, DAY, MIN }
  });
})();
