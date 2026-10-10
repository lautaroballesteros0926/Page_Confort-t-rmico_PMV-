/* Lectura del CSV y detección automática de columnas. */
(function (G) {
  'use strict';

  function splitLine(line, d) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === d && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function parse(text) {
    text = text.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('El archivo no tiene filas de datos.');
    const cnt = ch => (lines[0].match(new RegExp(ch === '\t' ? '\t' : '\\' + ch, 'g')) || []).length;
    const delim = [';', '\t', ','].map(d => [d, cnt(d)]).sort((a, b) => b[1] - a[1])[0][0];
    return { headers: splitLine(lines[0], delim), rows: lines.slice(1).map(l => splitLine(l, delim)), delim };
  }

  const num = (s, delim) => (s === undefined || s === '') ? NaN : Number(delim === ',' ? s : s.replace(',', '.'));
  const norm = h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function isNumericCol(t, j) {
    let ok = 0, n = 0;
    for (const r of t.rows.slice(0, 200)) { n++; if (isFinite(num(r[j], t.delim))) ok++; }
    return n > 0 && ok / n >= 0.5;
  }

  // Devuelve {date, ta, rh, tr, v, trm} con el índice de columna (o -1)
  function detect(t) {
    const H = t.headers.map(norm);
    const find = (re, ex) => H.findIndex(h => re.test(h) && !(ex && ex.test(h)));
    const m = {};
    const OUT = /ext|outdoor|predomin|prevail|running|trm|tout/;
    m.trm = find(OUT);
    m.tr = find(/rad|mrt|\btr\b|globo|globe/, OUT);
    m.rh = find(/hum|\brh\b|\bhr\b|relativ/, /absol|ratio|especif/);
    m.v = find(/vel|viento|wind|speed/, OUT);
    m.ta = find(/temp|bulbo|seco|dry|\bdb\b|\btbs\b|\bta\b|aire/, /rad|mrt|globo|hum|vel|viento|rocio|dew|humedo|wet|ext|outdoor|predomin|prevail|running|trm|tout/);
    m.date = find(/fecha|date|timestamp|datetime|hora|time|\bdia\b/);
    const used = new Set(Object.values(m));
    const free = () => H.findIndex((h, j) => !used.has(j) && isNumericCol(t, j));
    m.guessed = m.ta < 0 || m.rh < 0;
    if (m.ta < 0) { m.ta = free(); used.add(m.ta); }
    if (m.rh < 0) { m.rh = free(); used.add(m.rh); }
    return m;
  }

  function parseDate(s) {
    if (!s) return null;
    let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return { d: new Date(2000, 0, 1, +m[1], +m[2], +(m[3] || 0)), only: true };
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return { d: new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), only: false }; }
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d) ? null : { d, only: false };
  }

  /* ---- validaciones ---- */
  const MAX_BYTES = 20 * 1024 * 1024;
  const TA_RANGE = [-40, 60], RH_RANGE = [0, 100];

  function checkFile(f) {
    if (!/\.(csv|txt|tsv|xlsx|xlsm|xls)$/i.test(f.name)) {
      const ext = (f.name.match(/\.[^.]+$/) || ['(sin extensión)'])[0];
      throw new Error('Formato no soportado: ' + ext + '. Subí un archivo .csv o .xlsx.');
    }
    if (f.size === 0) throw new Error('El archivo está vacío.');
    if (f.size > MAX_BYTES) throw new Error('El archivo pesa ' + (f.size / 1048576).toFixed(1) + ' MB; el máximo es 20 MB.');
  }
  function checkText(text) {
    if (text.indexOf('\u0000') >= 0 || /^PK\u0003\u0004/.test(text))
      throw new Error('El contenido no es texto: parece un archivo binario (por ejemplo Excel) con extensión .csv.');
    if (!text.trim()) throw new Error('El archivo está vacío.');
  }
  function checkColumns(t, m) {
    if (t.headers.length < 2) throw new Error('No se detectó el separador de columnas. Usá coma (,), punto y coma (;) o tabulación.');
    if (m.ta < 0 || m.rh < 0 || m.ta === m.rh)
      throw new Error('No se encontraron las columnas de temperatura de bulbo seco y humedad relativa. Columnas del archivo: ' +
        t.headers.join(', ') + '.');
    [['temperatura', m.ta], ['humedad', m.rh]].forEach(([n, j]) => {
      if (!isNumericCol(t, j)) throw new Error('La columna de ' + n + ' ("' + t.headers[j] + '") no contiene valores numéricos.');
    });
  }

  // Convierte la tabla en registros según el mapeo de columnas.
  function toRecords(t, ci) {
    const H = t.headers.map(norm);
    const dIdx = H.findIndex(h => /fecha|date/.test(h)), tIdx = H.findIndex(h => /^hora|^time|hour/.test(h));
    const join = dIdx >= 0 && tIdx >= 0 && dIdx !== tIdx && (ci.date === dIdx || ci.date === tIdx);
    const rows = []; let nonNumeric = 0;
    t.rows.forEach(r => {
      const ta = num(r[ci.ta], t.delim), rh = num(r[ci.rh], t.delim);
      if (!isFinite(ta) || !isFinite(rh)) { nonNumeric++; return; }
      const ds = ci.date < 0 ? null : (join ? (r[dIdx] + ' ' + r[tIdx]).trim() : r[ci.date]);
      rows.push({ ds, ta, rh,
        tr: ci.tr >= 0 ? num(r[ci.tr], t.delim) : NaN,
        v: ci.v >= 0 ? num(r[ci.v], t.delim) : NaN,
        trm: ci.trm >= 0 ? num(r[ci.trm], t.delim) : NaN });
    });
    if (rows.length && Math.max(...rows.map(o => o.rh)) <= 1.0) rows.forEach(o => o.rh *= 100);
    const inRange = rows.filter(o => o.ta >= TA_RANGE[0] && o.ta <= TA_RANGE[1] && o.rh >= RH_RANGE[0] && o.rh <= RH_RANGE[1]);
    const outOfRange = rows.length - inRange.length;
    const out = inRange.map((o, i) => Object.assign(o, { i }));
    if (!out.length) throw new Error('No hay filas válidas: se esperan temperaturas entre ' + TA_RANGE[0] + ' y ' + TA_RANGE[1] +
      ' °C y humedad entre 0 y 100 %. (Filas sin números: ' + nonNumeric + ', fuera de rango: ' + outOfRange + '.)');
    const parsed = out.map(o => o.ds ? parseDate(o.ds) : null);
    const hasTime = parsed.every(p => p);
    const timeOnly = hasTime && parsed.every(p => p.only);
    out.forEach((o, k) => {
      o.t = hasTime ? parsed[k].d : o.i + 1;
      o.label = hasTime
        ? (timeOnly ? o.t.toTimeString().slice(0, 5) : o.t.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }))
        : '#' + (o.i + 1);
    });
    return { records: out, hasTime, timeOnly, skipped: { nonNumeric, outOfRange } };
  }

  G.CSV = { parse, detect, toRecords, checkFile, checkText, checkColumns };
})(window);
