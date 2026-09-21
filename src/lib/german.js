/**
 * German morphology, computed offline.
 *
 * Conjugation is rule-governed for weak verbs and table-driven for strong ones,
 * so the whole thing runs locally: no network, no rate limit, instant. The rule
 * that matters most here is the same one the translation code follows — never
 * invent an answer. A wrong Partizip II taught to a learner is worse than a
 * blank, so anything not derivable is reported as unknown rather than guessed.
 *
 * Covers: Präsens, Präteritum, Perfekt, Plusquamperfekt, Futur I,
 * Konjunktiv I & II, Imperativ, Partizip I & II, noun case tables and
 * adjective comparison.
 */
(function () {
  const PRONOUNS = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'];

  // Prefixes that detach in a main clause: "ich stehe auf".
  const SEPARABLE = [
    'auseinander', 'gegenüber', 'zusammen', 'entgegen', 'herunter', 'hinunter',
    'zurecht', 'zurück', 'herbei', 'herein', 'heraus', 'herauf', 'hinein',
    'hinaus', 'hinauf', 'vorbei', 'vorher', 'nieder', 'weiter', 'zwischen',
    'davon', 'daran', 'dabei', 'empor', 'fest', 'fort', 'frei', 'heim',
    'statt', 'teil', 'voran', 'vorau', 'vor', 'weg', 'zu', 'ab', 'an', 'auf',
    'aus', 'bei', 'ein', 'her', 'hin', 'los', 'mit', 'nach', 'über', 'um'
  ];

  // Prefixes that stay attached and suppress the ge- of the Partizip II.
  const INSEPARABLE = ['emp', 'ent', 'miss', 'ver', 'zer', 'be', 'er', 'ge'];

  /**
   * A separable verb normally shares its base's auxiliary — ankommen follows
   * kommen to sein, abfahren follows fahren. These are the ones where the
   * prefix changes it, and inheriting would produce "habe aufgestanden".
   */
  const SEPARABLE_AUX = {
    aufstehen: 'sein', einschlafen: 'sein', aufwachen: 'sein', aufwachsen: 'sein',
    umziehen: 'sein', einziehen: 'sein', ausziehen: 'sein', aufbrechen: 'sein',
    zurückkehren: 'sein', losgehen: 'sein', aufblühen: 'sein', einsteigen: 'sein',
    aussteigen: 'sein', umsteigen: 'sein'
  };

  /**
   * Strong and mixed verbs.
   *   p2    Partizip II, spelled out
   *   pt    Präteritum stem
   *   k2    Konjunktiv II stem (Präteritum stem, umlauted where possible)
   *   s2    Präsens stem for du / er-sie-es, when the vowel shifts
   *   aux   perfect auxiliary, 'haben' unless stated
   *   praes six explicit Präsens forms, for verbs no rule describes
   */
  const IRREGULAR = {
    sein: {
      p2: 'gewesen', pt: 'war', k2: 'wär', aux: 'sein',
      praes: ['bin', 'bist', 'ist', 'sind', 'seid', 'sind'],
      praet: ['war', 'warst', 'war', 'waren', 'wart', 'waren'],
      k1: ['sei', 'seiest', 'sei', 'seien', 'seiet', 'seien'],
      imp: ['sei', 'seid', 'seien Sie']
    },
    haben: {
      p2: 'gehabt', pt: 'hatt', k2: 'hätt',
      praes: ['habe', 'hast', 'hat', 'haben', 'habt', 'haben'],
      praet: ['hatte', 'hattest', 'hatte', 'hatten', 'hattet', 'hatten']
    },
    werden: {
      p2: 'geworden', pt: 'wurd', k2: 'würd', aux: 'sein',
      praes: ['werde', 'wirst', 'wird', 'werden', 'werdet', 'werden'],
      praet: ['wurde', 'wurdest', 'wurde', 'wurden', 'wurdet', 'wurden']
    },

    /**
     * Modal verbs: no -e in the ich-form, and 1sg equals 3sg.
     *
     * `modal: true` is not decoration. These are Präteritopräsentia — their
     * present tense descends from an old strong preterite, which is why the
     * ich-form has no ending, while the past is formed weakly (konnte, not a
     * strong ablaut). Calling them strong verbs, which is what happens to any
     * entry without a flag, is simply wrong, and it is wrong in the one panel
     * a German teacher will read most closely.
     *
     * The flag also drives the Ersatzinfinitiv caveat: a modal governing
     * another verb takes the infinitive in the perfect, not the Partizip II.
     */
    koennen: null, // placeholder replaced below (umlaut keys added programmatically)
    müssen: {
      p2: 'gemusst', pt: 'musst', k2: 'müsst', modal: true,
      praes: ['muss', 'musst', 'muss', 'müssen', 'müsst', 'müssen'],
      praet: ['musste', 'musstest', 'musste', 'mussten', 'musstet', 'mussten']
    },
    können: {
      p2: 'gekonnt', pt: 'konnt', k2: 'könnt', modal: true,
      praes: ['kann', 'kannst', 'kann', 'können', 'könnt', 'können'],
      praet: ['konnte', 'konntest', 'konnte', 'konnten', 'konntet', 'konnten']
    },
    dürfen: {
      p2: 'gedurft', pt: 'durft', k2: 'dürft', modal: true,
      praes: ['darf', 'darfst', 'darf', 'dürfen', 'dürft', 'dürfen'],
      praet: ['durfte', 'durftest', 'durfte', 'durften', 'durftet', 'durften']
    },
    sollen: {
      p2: 'gesollt', pt: 'sollt', k2: 'sollt', modal: true,
      praes: ['soll', 'sollst', 'soll', 'sollen', 'sollt', 'sollen'],
      praet: ['sollte', 'solltest', 'sollte', 'sollten', 'solltet', 'sollten']
    },
    wollen: {
      p2: 'gewollt', pt: 'wollt', k2: 'wollt', modal: true,
      praes: ['will', 'willst', 'will', 'wollen', 'wollt', 'wollen'],
      praet: ['wollte', 'wolltest', 'wollte', 'wollten', 'wolltet', 'wollten']
    },
    mögen: {
      p2: 'gemocht', pt: 'mocht', k2: 'möcht', modal: true,
      praes: ['mag', 'magst', 'mag', 'mögen', 'mögt', 'mögen'],
      praet: ['mochte', 'mochtest', 'mochte', 'mochten', 'mochtet', 'mochten']
    },
    /**
     * wissen is a Präteritopräsens too — hence "weiß" with no ending — but it
     * is not a modal: it governs a clause, not a bare infinitive, so no
     * Ersatzinfinitiv. Vowel change plus weak endings is exactly the mixed
     * pattern (weiß · wusste · gewusst), which is how it is taught.
     */
    wissen: {
      p2: 'gewusst', pt: 'wusst', k2: 'wüsst', weakPast: true,
      praes: ['weiß', 'weißt', 'weiß', 'wissen', 'wisst', 'wissen'],
      praet: ['wusste', 'wusstest', 'wusste', 'wussten', 'wusstet', 'wussten']
    },

    // Mixed verbs: weak endings on a changed stem.
    bringen: { p2: 'gebracht', pt: 'bracht', k2: 'brächt', weakPast: true },
    denken: { p2: 'gedacht', pt: 'dacht', k2: 'dächt', weakPast: true },
    kennen: { p2: 'gekannt', pt: 'kannt', k2: 'kennt', weakPast: true },
    nennen: { p2: 'genannt', pt: 'nannt', k2: 'nennt', weakPast: true },
    rennen: { p2: 'gerannt', pt: 'rannt', k2: 'rennt', weakPast: true, aux: 'sein' },
    brennen: { p2: 'gebrannt', pt: 'brannt', k2: 'brennt', weakPast: true },

    // Strong verbs.
    gehen: { p2: 'gegangen', pt: 'ging', k2: 'ging', aux: 'sein' },
    kommen: { p2: 'gekommen', pt: 'kam', k2: 'käm', aux: 'sein' },
    stehen: { p2: 'gestanden', pt: 'stand', k2: 'stünd' },
    tun: { p2: 'getan', pt: 'tat', k2: 'tät' },
    sehen: { p2: 'gesehen', pt: 'sah', k2: 'säh', s2: 'sieh' },
    geben: { p2: 'gegeben', pt: 'gab', k2: 'gäb', s2: 'gib' },
    nehmen: { p2: 'genommen', pt: 'nahm', k2: 'nähm', s2: 'nimm' },
    sprechen: { p2: 'gesprochen', pt: 'sprach', k2: 'spräch', s2: 'sprich' },
    essen: { p2: 'gegessen', pt: 'aß', k2: 'äß', s2: 'iss' },
    lesen: { p2: 'gelesen', pt: 'las', k2: 'läs', s2: 'lies' },
    // Takes both: "ist getreten" for motion, "hat getreten" for kicking.
    // Follows Wiktionary's default so the verifier stays meaningful.
    treten: { p2: 'getreten', pt: 'trat', k2: 'trät', s2: 'tritt' },
    vergessen: { p2: 'vergessen', pt: 'vergaß', k2: 'vergäß', s2: 'vergiss' },
    messen: { p2: 'gemessen', pt: 'maß', k2: 'mäß', s2: 'miss' },
    helfen: { p2: 'geholfen', pt: 'half', k2: 'hülf', s2: 'hilf' },
    treffen: { p2: 'getroffen', pt: 'traf', k2: 'träf', s2: 'triff' },
    werfen: { p2: 'geworfen', pt: 'warf', k2: 'würf', s2: 'wirf' },
    sterben: { p2: 'gestorben', pt: 'starb', k2: 'stürb', s2: 'stirb', aux: 'sein' },
    gelten: { p2: 'gegolten', pt: 'galt', k2: 'gält', s2: 'gilt' },
    empfehlen: { p2: 'empfohlen', pt: 'empfahl', k2: 'empfähl', s2: 'empfiehl' },
    stehlen: { p2: 'gestohlen', pt: 'stahl', k2: 'stähl', s2: 'stiehl' },
    befehlen: { p2: 'befohlen', pt: 'befahl', k2: 'befähl', s2: 'befiehl' },
    fahren: { p2: 'gefahren', pt: 'fuhr', k2: 'führ', s2: 'fähr', aux: 'sein' },
    tragen: { p2: 'getragen', pt: 'trug', k2: 'trüg', s2: 'träg' },
    schlagen: { p2: 'geschlagen', pt: 'schlug', k2: 'schlüg', s2: 'schläg' },
    graben: { p2: 'gegraben', pt: 'grub', k2: 'grüb', s2: 'gräb' },
    laden: { p2: 'geladen', pt: 'lud', k2: 'lüd', s2: 'läd' },
    wachsen: { p2: 'gewachsen', pt: 'wuchs', k2: 'wüchs', s2: 'wächs', aux: 'sein' },
    waschen: { p2: 'gewaschen', pt: 'wusch', k2: 'wüsch', s2: 'wäsch' },
    laufen: { p2: 'gelaufen', pt: 'lief', k2: 'lief', s2: 'läuf', aux: 'sein' },
    schlafen: { p2: 'geschlafen', pt: 'schlief', k2: 'schlief', s2: 'schläf' },
    fallen: { p2: 'gefallen', pt: 'fiel', k2: 'fiel', s2: 'fäll', aux: 'sein' },
    halten: { p2: 'gehalten', pt: 'hielt', k2: 'hielt', s2: 'hält' },
    lassen: { p2: 'gelassen', pt: 'ließ', k2: 'ließ', s2: 'läss' },
    raten: { p2: 'geraten', pt: 'riet', k2: 'riet', s2: 'rät' },
    braten: { p2: 'gebraten', pt: 'briet', k2: 'briet', s2: 'brät' },
    fangen: { p2: 'gefangen', pt: 'fing', k2: 'fing', s2: 'fäng' },
    hängen: { p2: 'gehangen', pt: 'hing', k2: 'hing' },
    rufen: { p2: 'gerufen', pt: 'rief', k2: 'rief' },
    heißen: { p2: 'geheißen', pt: 'hieß', k2: 'hieß' },
    finden: { p2: 'gefunden', pt: 'fand', k2: 'fänd' },
    binden: { p2: 'gebunden', pt: 'band', k2: 'bänd' },
    trinken: { p2: 'getrunken', pt: 'trank', k2: 'tränk' },
    singen: { p2: 'gesungen', pt: 'sang', k2: 'säng' },
    springen: { p2: 'gesprungen', pt: 'sprang', k2: 'spräng', aux: 'sein' },
    zwingen: { p2: 'gezwungen', pt: 'zwang', k2: 'zwäng' },
    klingen: { p2: 'geklungen', pt: 'klang', k2: 'kläng' },
    sinken: { p2: 'gesunken', pt: 'sank', k2: 'sänk', aux: 'sein' },
    gelingen: { p2: 'gelungen', pt: 'gelang', k2: 'geläng', aux: 'sein' },
    beginnen: { p2: 'begonnen', pt: 'begann', k2: 'begänn' },
    gewinnen: { p2: 'gewonnen', pt: 'gewann', k2: 'gewänn' },
    schwimmen: { p2: 'geschwommen', pt: 'schwamm', k2: 'schwömm', aux: 'sein' },
    bleiben: { p2: 'geblieben', pt: 'blieb', k2: 'blieb', aux: 'sein' },
    schreiben: { p2: 'geschrieben', pt: 'schrieb', k2: 'schrieb' },
    treiben: { p2: 'getrieben', pt: 'trieb', k2: 'trieb' },
    reiben: { p2: 'gerieben', pt: 'rieb', k2: 'rieb' },
    steigen: { p2: 'gestiegen', pt: 'stieg', k2: 'stieg', aux: 'sein' },
    scheinen: { p2: 'geschienen', pt: 'schien', k2: 'schien' },
    schweigen: { p2: 'geschwiegen', pt: 'schwieg', k2: 'schwieg' },
    leihen: { p2: 'geliehen', pt: 'lieh', k2: 'lieh' },
    meiden: { p2: 'gemieden', pt: 'mied', k2: 'mied' },
    weisen: { p2: 'gewiesen', pt: 'wies', k2: 'wies' },
    schneiden: { p2: 'geschnitten', pt: 'schnitt', k2: 'schnitt' },
    greifen: { p2: 'gegriffen', pt: 'griff', k2: 'griff' },
    pfeifen: { p2: 'gepfiffen', pt: 'pfiff', k2: 'pfiff' },
    reiten: { p2: 'geritten', pt: 'ritt', k2: 'ritt', aux: 'sein' },
    streiten: { p2: 'gestritten', pt: 'stritt', k2: 'stritt' },
    leiden: { p2: 'gelitten', pt: 'litt', k2: 'litt' },
    beißen: { p2: 'gebissen', pt: 'biss', k2: 'biss' },
    reißen: { p2: 'gerissen', pt: 'riss', k2: 'riss' },
    gleichen: { p2: 'geglichen', pt: 'glich', k2: 'glich' },
    schleichen: { p2: 'geschlichen', pt: 'schlich', k2: 'schlich', aux: 'sein' },
    weichen: { p2: 'gewichen', pt: 'wich', k2: 'wich', aux: 'sein' },
    ziehen: { p2: 'gezogen', pt: 'zog', k2: 'zög' },
    fliegen: { p2: 'geflogen', pt: 'flog', k2: 'flög', aux: 'sein' },
    biegen: { p2: 'gebogen', pt: 'bog', k2: 'bög' },
    bieten: { p2: 'geboten', pt: 'bot', k2: 'böt' },
    fliehen: { p2: 'geflohen', pt: 'floh', k2: 'flöh', aux: 'sein' },
    fließen: { p2: 'geflossen', pt: 'floss', k2: 'flöss', aux: 'sein' },
    genießen: { p2: 'genossen', pt: 'genoss', k2: 'genöss' },
    gießen: { p2: 'gegossen', pt: 'goss', k2: 'göss' },
    schießen: { p2: 'geschossen', pt: 'schoss', k2: 'schöss' },
    schließen: { p2: 'geschlossen', pt: 'schloss', k2: 'schlöss' },
    riechen: { p2: 'gerochen', pt: 'roch', k2: 'röch' },
    kriechen: { p2: 'gekrochen', pt: 'kroch', k2: 'kröch', aux: 'sein' },
    lügen: { p2: 'gelogen', pt: 'log', k2: 'lög' },
    betrügen: { p2: 'betrogen', pt: 'betrog', k2: 'betrög' },
    wiegen: { p2: 'gewogen', pt: 'wog', k2: 'wög' },
    schieben: { p2: 'geschoben', pt: 'schob', k2: 'schöb' },
    heben: { p2: 'gehoben', pt: 'hob', k2: 'höb' },
    liegen: { p2: 'gelegen', pt: 'lag', k2: 'läg' },
    sitzen: { p2: 'gesessen', pt: 'saß', k2: 'säß' },
    bitten: { p2: 'gebeten', pt: 'bat', k2: 'bät' },
    schaffen: { p2: 'geschaffen', pt: 'schuf', k2: 'schüf' },
    verlieren: { p2: 'verloren', pt: 'verlor', k2: 'verlör' },
    schmelzen: { p2: 'geschmolzen', pt: 'schmolz', k2: 'schmölz', s2: 'schmilz' },
    verderben: { p2: 'verdorben', pt: 'verdarb', k2: 'verdürb', s2: 'verdirb' },

    // Inseparable-prefix verbs whose auxiliary is sein, which derivation would
    // otherwise get wrong, plus the most common ones worth pinning down.
    entstehen: { p2: 'entstanden', pt: 'entstand', k2: 'entstünd', aux: 'sein' },
    // Konjunktiv II umlauts: es geschähe, not "geschehe" (caught by tools/verify-verbs.js).
    geschehen: { p2: 'geschehen', pt: 'geschah', k2: 'geschäh', s2: 'geschieh', aux: 'sein' },
    erscheinen: { p2: 'erschienen', pt: 'erschien', k2: 'erschien', aux: 'sein' },
    verschwinden: { p2: 'verschwunden', pt: 'verschwand', k2: 'verschwänd', aux: 'sein' },
    misslingen: { p2: 'misslungen', pt: 'misslang', k2: 'missläng', aux: 'sein' },
    bekommen: { p2: 'bekommen', pt: 'bekam', k2: 'bekäm' },
    gefallen: { p2: 'gefallen', pt: 'gefiel', k2: 'gefiel', s2: 'gefäll' },
    erhalten: { p2: 'erhalten', pt: 'erhielt', k2: 'erhielt', s2: 'erhält' },
    entscheiden: { p2: 'entschieden', pt: 'entschied', k2: 'entschied' },
    unterscheiden: { p2: 'unterschieden', pt: 'unterschied', k2: 'unterschied' },
    versprechen: { p2: 'versprochen', pt: 'versprach', k2: 'verspräch', s2: 'versprich' },
    verbringen: { p2: 'verbracht', pt: 'verbracht', k2: 'verbrächt', weakPast: true },
    besitzen: { p2: 'besessen', pt: 'besaß', k2: 'besäß' },
    bestehen: { p2: 'bestanden', pt: 'bestand', k2: 'bestünd' },
    erfahren: { p2: 'erfahren', pt: 'erfuhr', k2: 'erführ', s2: 'erfähr' }
  };
  delete IRREGULAR.koennen;

  /**
   * The generated table from German Wiktionary (src/lib/german-verbs.js), if it
   * has been loaded. It is what makes "not in the table, therefore regular" a
   * safe inference rather than a hope: German's strong verbs are a closed class,
   * and generating the list keeps it closed.
   *
   * The hand-written entries above win on conflict — they carry fully spelled
   * out forms for sein, haben, werden and the modals, which no stem table can
   * express, and they are covered by tests/german.js.
   */
  const GENERATED = globalThis.GL_VERBS || null;
  const GENERATED_META = globalThis.GL_VERBS_META || null;
  // Only a complete generated list justifies "absent, therefore regular".
  const LIST_COMPLETE = !!(GENERATED && GENERATED_META && GENERATED_META.complete);

  function lookup(inf) {
    if (IRREGULAR[inf]) return IRREGULAR[inf];
    if (!GENERATED || !GENERATED[inf]) return null;
    const g = GENERATED[inf];
    // Normalise the generated shape onto the one the rules below expect.
    return {
      p2: g.p2,
      pt: g.pt,
      k2: g.k2,
      s2: g.s2,
      aux: g.aux || 'haben',
      weakPast: !!g.weak,
      sep: g.sep || null
    };
  }

  /* ------------------------------------------------------------- helpers -- */

  const lower = (s) => (s || '').trim().toLowerCase();

  /**
   * Whether a stem needs an -e before -st/-t: arbeit→arbeitest, rechn→rechnest.
   * The m/n case turns on what precedes it — a consonant forces the e (öffnen,
   * atmen, rechnen), but l, r, m, n do not (lernen, filmen, kommen), and nor
   * does a silent h after a vowel (wohnen → du wohnst, unlike rechnen).
   */
  function needsE(stem) {
    if (/[dt]$/.test(stem)) return true;
    const m = /(.)[mn]$/.exec(stem);
    if (!m) return false;
    const prev = m[1];
    if (/[aeiouäöü]/.test(prev)) return false;
    if (/[lrmn]/.test(prev)) return false;
    if (prev === 'h') return !/[aeiouäöü]h[mn]$/.test(stem);
    return true;
  }

  /** A stem already ending in an s-sound takes only -t in the du-form. */
  const sibilant = (stem) => /(?:[sxzß]|tz|chs)$/.test(stem);

  function isInfinitive(word) {
    return /(?:en|ern|eln|n)$/.test(word) && word.length > 2;
  }

  function stemOf(inf) {
    if (/eln$/.test(inf) || /ern$/.test(inf)) return inf.slice(0, -1); // sammel-, änder-
    if (/en$/.test(inf)) return inf.slice(0, -2);
    if (/n$/.test(inf)) return inf.slice(0, -1); // tu-
    return inf;
  }

  /**
   * Splits a separable prefix off an infinitive, but only when what remains is
   * itself a plausible verb — otherwise "angeln" would be read as an+geln.
   */
  function splitSeparable(inf) {
    for (const prefix of SEPARABLE) {
      if (!inf.startsWith(prefix)) continue;
      const rest = inf.slice(prefix.length);
      if (rest.length < 3 || !isInfinitive(rest)) continue;
      if (lookup(rest) || rest.length >= 4) return { prefix, base: rest };
    }
    return null;
  }

  const hasInseparable = (inf) =>
    INSEPARABLE.some((p) => inf.startsWith(p) && inf.length > p.length + 2);

  /**
   * An inseparable prefix on a strong verb keeps every stem change but drops
   * the ge- of the Partizip II: stehen → gestanden, verstehen → verstanden.
   * The auxiliary is not inherited — prefixing usually makes a verb transitive
   * and pushes it to haben (kommen/sein but bekommen/haben) — so anything whose
   * auxiliary is not haben is listed explicitly in the table instead.
   */
  function deriveInseparable(inf) {
    for (const p of INSEPARABLE) {
      if (!inf.startsWith(p) || inf.length <= p.length + 2) continue;
      const base = lookup(inf.slice(p.length));
      if (!base || base.praes || base.praet) continue; // fully irregular bases do not transfer
      return {
        p2: p + base.p2.replace(/^ge/, ''),
        pt: p + base.pt,
        k2: p + base.k2,
        s2: base.s2 ? p + base.s2 : undefined,
        weakPast: base.weakPast,
        aux: 'haben'
      };
    }
    return null;
  }

  /* --------------------------------------------------------- conjugation -- */

  function partizip2(inf, entry, sep) {
    if (entry && entry.p2) return sep ? sep.prefix + entry.p2 : entry.p2;

    const stem = stemOf(inf);
    const ending = needsE(stem) ? 'et' : 't';

    if (/ieren$/.test(inf)) return stem + 't'; // studieren → studiert, never ge-
    if (sep) {
      const baseStem = stemOf(sep.base);
      return sep.prefix + 'ge' + baseStem + (needsE(baseStem) ? 'et' : 't');
    }
    if (hasInseparable(inf)) return stem + ending; // besuchen → besucht
    return 'ge' + stem + ending;
  }

  function praesensForms(inf, entry, sep) {
    if (entry && entry.praes) {
      return sep ? entry.praes.map((f) => f + ' ' + sep.prefix) : entry.praes.slice();
    }

    const stem = stemOf(inf);
    const shifted = entry && entry.s2 ? entry.s2 : null; // vowel-shifted du / er stem
    const alt = shifted || stem;

    const ich = /eln$/.test(inf) ? stem.replace(/el$/, 'l') + 'e' : stem + 'e';

    // A shifted stem never takes the connecting -e: du hältst, er hält — not
    // "hältest". An unshifted stem follows the ordinary spelling rule.
    const du = shifted
      ? alt + (sibilant(alt) ? 't' : 'st')
      : alt + (sibilant(alt) ? 't' : needsE(alt) ? 'est' : 'st');
    const er = shifted
      ? (/t$/.test(alt) ? alt : alt + 't')
      : alt + (needsE(alt) ? 'et' : 't');

    const ihr = stem + (needsE(stem) ? 'et' : 't');

    const forms = [ich, du, er, inf, ihr, inf];
    return sep ? forms.map((f) => f + ' ' + sep.prefix) : forms;
  }

  function praeteritumForms(inf, entry, sep) {
    let forms;
    if (entry && entry.praet) {
      forms = entry.praet.slice();
    } else if (entry && entry.weakPast) {
      // Mixed verbs: changed stem, weak endings.
      const b = entry.pt + 'e';
      forms = [b, b + 'st', b, b + 'n', b + 't', b + 'n'];
    } else if (entry) {
      const p = entry.pt;
      const duEnd = sibilant(p) || needsE(p) ? 'est' : 'st';
      const ihrEnd = needsE(p) ? 'et' : 't';
      forms = [p, p + duEnd, p, p + 'en', p + ihrEnd, p + 'en'];
    } else {
      const stem = stemOf(inf);
      const b = stem + (needsE(stem) ? 'ete' : 'te');
      forms = [b, b + 'st', b, b + 'n', b + 't', b + 'n'];
    }
    return sep ? forms.map((f) => f + ' ' + sep.prefix) : forms;
  }

  const E_ENDINGS = ['e', 'est', 'e', 'en', 'et', 'en'];

  function konjunktiv1Forms(inf, entry, sep) {
    if (entry && entry.k1) return sep ? entry.k1.map((f) => f + ' ' + sep.prefix) : entry.k1.slice();
    const stem = stemOf(inf);
    const forms = E_ENDINGS.map((e, i) => (i === 3 || i === 5 ? inf : stem + e));
    return sep ? forms.map((f) => f + ' ' + sep.prefix) : forms;
  }

  function konjunktiv2Forms(inf, entry, sep) {
    // Weak verbs have no distinct Konjunktiv II — it is the Präteritum, which is
    // why everyday German uses würde + Infinitiv instead.
    if (!entry) return null;
    const k = entry.k2;
    const forms = E_ENDINGS.map((e) => k + e);
    return sep ? forms.map((f) => f + ' ' + sep.prefix) : forms;
  }

  function imperativForms(inf, entry, sep, fullInf) {
    if (entry && entry.imp) return entry.imp.slice();
    const stem = stemOf(inf);
    // e→i/ie verbs use the shifted stem and drop the -e (gib!, sprich!, lies!),
    // while a→ä verbs do not umlaut the imperative at all (fahr!, halt!).
    const eChange = entry && entry.s2 && entry.s2 !== stem && !/[äöü]/.test(entry.s2);

    const du = eChange ? entry.s2 : stem + (needsE(stem) ? 'e' : '');
    const ihr = stem + (needsE(stem) ? 'et' : 't');
    // The polite form splits too: "stehen Sie auf", not "aufstehen Sie".
    if (sep) {
      return [du + ' ' + sep.prefix, ihr + ' ' + sep.prefix, sep.base + ' Sie ' + sep.prefix];
    }
    return [du, ihr, (fullInf || inf) + ' Sie'];
  }

  const AUX = {
    haben: {
      praes: ['habe', 'hast', 'hat', 'haben', 'habt', 'haben'],
      praet: ['hatte', 'hattest', 'hatte', 'hatten', 'hattet', 'hatten'],
      k2: ['hätte', 'hättest', 'hätte', 'hätten', 'hättet', 'hätten']
    },
    sein: {
      praes: ['bin', 'bist', 'ist', 'sind', 'seid', 'sind'],
      praet: ['war', 'warst', 'war', 'waren', 'wart', 'waren'],
      k2: ['wäre', 'wärest', 'wäre', 'wären', 'wäret', 'wären']
    }
  };
  const WERDEN = ['werde', 'wirst', 'wird', 'werden', 'werdet', 'werden'];
  const WUERDE = ['würde', 'würdest', 'würde', 'würden', 'würdet', 'würden'];

  /**
   * Full conjugation of a German infinitive.
   * @returns {object|null} null when the word is not an infinitive
   */
  function conjugate(infinitive) {
    const inf = lower(infinitive);
    if (!inf || /\s/.test(inf) || !isInfinitive(inf)) return null;

    let entry = lookup(inf);
    // Where the forms come from, so the UI can say how far to trust them:
    //   table    the verb is listed as irregular; forms are known
    //   derived  a prefixed form of a listed verb
    //   rules    not listed, so conjugated as a regular verb
    let source = entry ? 'table' : 'rules';
    let sep = null;

    if (entry && entry.sep) {
      // The generated table stores a separable verb's stems without its prefix.
      sep = { prefix: entry.sep, base: inf.slice(entry.sep.length) };
    } else if (!entry) {
      const split = splitSeparable(inf);
      if (split) {
        sep = split; // the base may be strong or weak; both are handled below
        entry = lookup(split.base);
        if (entry) source = 'derived';
      } else {
        // An inseparable prefix keeps the base's stem changes but loses the ge-.
        entry = deriveInseparable(inf);
        if (entry) source = 'derived';
      }
    }

    // Personal forms are built from the base verb and the prefix is appended,
    // because that is what German does: aufstehen → "ich stehe auf".
    const workInf = sep ? sep.base : inf;

    const p2 = partizip2(inf, entry, sep);
    const aux = SEPARABLE_AUX[inf] || (entry && entry.aux) || 'haben';
    const auxForms = AUX[aux];

    const praes = praesensForms(workInf, entry, sep);
    const praet = praeteritumForms(workInf, entry, sep);
    const k1 = konjunktiv1Forms(workInf, entry, sep);
    const k2 = konjunktiv2Forms(workInf, entry, sep);

    return {
      infinitive: inf,
      // Order matters: a modal is checked before the weakPast/strong split,
      // because it is neither — it is a preterite-present, and falling through
      // to "strong" is how können ended up labelled a strong verb.
      kind: entry ? (entry.modal ? 'modal' : entry.weakPast ? 'mixed' : 'strong') : 'weak',
      // Drives the Ersatzinfinitiv caveat on the Perfekt.
      modal: !!(entry && entry.modal),
      source,
      // True when the irregular list is the generated, comprehensive one, in
      // which case "absent from the list" reliably means "regular".
      listComplete: LIST_COMPLETE,
      separable: sep ? sep.prefix : null,
      auxiliary: aux,
      partizip1: inf + 'd',
      partizip2: p2,
      tenses: [
        { key: 'praesens', label: 'Präsens', note: 'present', forms: praes },
        { key: 'praeteritum', label: 'Präteritum', note: 'simple past, written narrative', forms: praet },
        {
          key: 'perfekt',
          label: 'Perfekt',
          note: 'spoken past — ' + aux + ' + Partizip II',
          forms: auxForms.praes.map((a) => a + ' ' + p2)
        },
        {
          key: 'plusquamperfekt',
          label: 'Plusquamperfekt',
          note: 'past before the past',
          forms: auxForms.praet.map((a) => a + ' ' + p2)
        },
        {
          key: 'futur1',
          label: 'Futur I',
          note: 'werden + Infinitiv',
          forms: WERDEN.map((w) => w + ' ' + inf)
        },
        { key: 'konjunktiv1', label: 'Konjunktiv I', note: 'reported speech', forms: k1 },
        k2
          ? { key: 'konjunktiv2', label: 'Konjunktiv II', note: 'hypothetical — would', forms: k2 }
          : {
              key: 'konjunktiv2',
              label: 'Konjunktiv II',
              note: 'weak verbs use würde + Infinitiv; the plain form matches the Präteritum',
              forms: WUERDE.map((w) => w + ' ' + inf)
            },
        {
          key: 'konjunktiv2perfekt',
          label: 'Konjunktiv II Perfekt',
          note: 'would have',
          forms: auxForms.k2.map((a) => a + ' ' + p2)
        }
      ],
      imperative: imperativForms(workInf, entry, sep, inf),
      pronouns: PRONOUNS.slice()
    };
  }

  /* ------------------------------------------------------- lemmatisation -- */

  let formIndex = null;

  /** Builds a reverse map from every generated form back to its infinitive. */
  function buildIndex() {
    if (formIndex) return formIndex;
    formIndex = new Map();
    const add = (form, inf) => {
      const key = lower(form);
      if (key && !formIndex.has(key)) formIndex.set(key, inf);
    };
    const known = Object.keys(IRREGULAR);
    if (GENERATED) Object.keys(GENERATED).forEach((k) => known.push(k));
    known.forEach((inf) => {
      const c = conjugate(inf);
      if (!c) return;
      add(inf, inf);
      add(c.partizip2, inf);
      add(c.partizip1, inf);
      c.tenses.forEach((t) => t.forms.forEach((f) => add(f, inf)));
      c.imperative.forEach((f) => add(f, inf));
    });
    return formIndex;
  }

  /**
   * Maps an inflected form back to an infinitive.
   * @returns {{infinitive: string, certain: boolean}|null}
   */
  function lemmatize(word) {
    const w = lower(word);
    if (!w || /\s/.test(w)) return null;

    if (lookup(w)) return { infinitive: w, certain: true };

    const index = buildIndex();
    if (index.has(w)) return { infinitive: index.get(w), certain: true };

    if (isInfinitive(w)) return { infinitive: w, certain: true };

    // Weak forms: peel off an ending and see whether a verb is left. The ge-…-t
    // shape is tried first, or "gemacht" would strip to "gemach" and suggest
    // the non-word "gemachen".
    const candidates = [];
    if (/^ge.+t$/.test(w)) candidates.push(w.replace(/^ge/, '').replace(/e?t$/, ''));
    if (/^ge.+en$/.test(w)) candidates.push(w.replace(/^ge/, '').replace(/en$/, ''));
    const strip = [
      [/test$/, ''], [/tet$/, ''], [/ten$/, ''], [/te$/, ''],
      [/est$/, ''], [/st$/, ''], [/et$/, ''], [/t$/, ''], [/e$/, '']
    ];
    strip.forEach(([re, rep]) => {
      if (re.test(w)) candidates.push(w.replace(re, rep));
    });

    for (const stem of candidates) {
      if (stem.length < 2) continue;
      for (const suffix of ['en', 'n']) {
        const guess = stem + suffix;
        if (lookup(guess)) return { infinitive: guess, certain: true };
      }
    }
    // A plausible weak infinitive, but nothing confirms it.
    for (const stem of candidates) {
      if (stem.length >= 3) return { infinitive: stem + 'en', certain: false };
    }
    return null;
  }

  /* --------------------------------------------------------------- nouns -- */

  const CASES = ['Nominativ', 'Akkusativ', 'Dativ', 'Genitiv'];

  /**
   * Case table for a noun. The article pattern follows from the gender, so it
   * is exact; the plural is not derivable in German and is only shown when the
   * caller supplies one.
   */
  function declineNoun(noun, gender, plural) {
    if (!noun || !gender) return null;
    const g = gender.replace(/^(der|die|das)$/, (m) => m);
    const word = noun.charAt(0).toUpperCase() + noun.slice(1);

    // -es after a sibilant, and after a single syllable (des Mannes, des Kindes);
    // plain -s once the noun has more than one (des Lehrers).
    const syllables = (word.toLowerCase().match(/[aeiouäöüy]+/g) || []).length;
    const genEnding = /(?:[sßxz]|sch|st)$/.test(word.toLowerCase()) || syllables <= 1 ? 'es' : 's';

    let singular;
    if (g === 'der') {
      singular = ['der ' + word, 'den ' + word, 'dem ' + word, 'des ' + word + genEnding];
    } else if (g === 'das') {
      singular = ['das ' + word, 'das ' + word, 'dem ' + word, 'des ' + word + genEnding];
    } else {
      singular = ['die ' + word, 'die ' + word, 'der ' + word, 'der ' + word];
    }

    let pluralForms = null;
    if (plural) {
      const p = plural.charAt(0).toUpperCase() + plural.slice(1);
      // The dative plural takes -n unless the plural already ends in -n or -s.
      const dat = /(?:n|s)$/.test(p) ? p : p + 'n';
      pluralForms = ['die ' + p, 'die ' + p, 'den ' + dat, 'der ' + p];
    }

    return { word, gender: g, cases: CASES.slice(), singular, plural: pluralForms };
  }

  /* ---------------------------------------------------------- adjectives -- */

  // Monosyllables that take an umlaut in the comparative.
  const UMLAUT_ADJ = {
    alt: 'ält', arm: 'ärm', dumm: 'dümm', grob: 'gröb', groß: 'größ', hart: 'härt',
    jung: 'jüng', kalt: 'kält', klug: 'klüg', krank: 'kränk', kurz: 'kürz',
    lang: 'läng', scharf: 'schärf', schwach: 'schwäch', schwarz: 'schwärz',
    stark: 'stärk', warm: 'wärm'
  };

  const IRREGULAR_ADJ = {
    gut: ['besser', 'am besten'],
    viel: ['mehr', 'am meisten'],
    gern: ['lieber', 'am liebsten'],
    hoch: ['höher', 'am höchsten'],
    nah: ['näher', 'am nächsten'],
    // Ends in ß but takes plain -ten, not the -esten the rule would predict.
    groß: ['größer', 'am größten']
  };

  function compareAdjective(word) {
    const w = lower(word);
    if (!w || /\s/.test(w) || w.length < 3) return null;

    if (IRREGULAR_ADJ[w]) {
      return { positive: w, comparative: IRREGULAR_ADJ[w][0], superlative: IRREGULAR_ADJ[w][1], irregular: true };
    }

    const base = UMLAUT_ADJ[w] || w;
    // -er drops its e: teuer → teurer.
    const comparative = (/er$/.test(base) && !UMLAUT_ADJ[w] ? base.replace(/er$/, 'r') : base) + 'er';
    const supEnding = /(?:[dtszß]|sch)$/.test(base) ? 'esten' : 'sten';
    return {
      positive: w,
      comparative,
      superlative: 'am ' + base + supEnding,
      irregular: false
    };
  }

  /* -------------------------------------------------------------- facade -- */

  /**
   * Works out what grammar is worth showing for a word.
   * @param {string} word      the word as it appeared on the page
   * @param {string} posHint   part of speech from the dictionary, if known
   */
  function analyze(word, posHint) {
    const raw = (word || '').trim();
    if (!raw || /\s/.test(raw)) return null;

    const pos = lower(posHint);
    const capitalised = /^[A-ZÄÖÜ]/.test(raw);
    const w = lower(raw);

    // Nouns are capitalised in German, and the dictionary usually confirms it.
    if (pos === 'noun' || (capitalised && !pos)) {
      const hint = globalThis.GL.grammar.germanHint(raw);
      const gender = hint && hint.article ? hint.article : null;
      return {
        type: 'noun',
        word: raw,
        gender,
        genderNote: hint ? hint.note : null,
        declension: gender ? declineNoun(raw, gender) : null,
        unknown: gender ? null : 'The gender of this noun is not derivable from its ending, so no case table is shown.'
      };
    }

    if (pos === 'adjective' || pos === 'adverb') {
      const c = compareAdjective(w);
      if (c) return { type: 'adjective', word: raw, comparison: c };
    }

    const lemma = lemmatize(w);
    if (lemma) {
      const table = conjugate(lemma.infinitive);
      if (table) {
        return {
          type: 'verb',
          word: raw,
          lemma: lemma.infinitive,
          inflected: lemma.infinitive !== w,
          certain: lemma.certain,
          conjugation: table
        };
      }
    }

    if (!pos && !capitalised) {
      const c = compareAdjective(w);
      if (c) return { type: 'adjective', word: raw, comparison: c };
    }

    return null;
  }

  globalThis.GL = Object.assign(globalThis.GL || {}, {
    german: {
      PRONOUNS,
      SEPARABLE,
      INSEPARABLE,
      conjugate,
      lemmatize,
      declineNoun,
      compareAdjective,
      analyze,
      isInfinitive,
      irregularCount: () => Object.keys(IRREGULAR).length + (GENERATED ? Object.keys(GENERATED).length : 0),
      hasGeneratedTable: () => !!GENERATED,
      listComplete: () => LIST_COMPLETE,
      tableMeta: () => GENERATED_META
    }
  });
})();
