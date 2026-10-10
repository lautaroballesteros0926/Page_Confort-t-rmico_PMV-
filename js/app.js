/* Estado de la aplicación, controles y orquestación. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { Comfort, Psychro, Adaptive, CSV, Charts } = window;

  const FIELDS = { met: [0.7, 4], clo: [0, 2], v: [0, 3], tr: [0, 60], trm: [-20, 50] };
  const ACTIVITIES = [
    ['Reclinado', 0.8], ['Sentado, tranquilo', 1.0], ['Sedentario (oficina)', 1.2], ['De pie, relajado', 1.2],
    ['De pie, trabajo ligero', 1.6], ['Caminando 2 km/h', 1.9], ['Caminando 3 km/h', 2.0], ['Caminando 4 km/h', 2.6]
  ];
  const CLOTHING = [
    ['Desnudo', 0], ['Shorts y remera', 0.36], ['Verano, liviana', 0.5], ['Pantalón y camisa manga larga', 0.61],
    ['Pantalón, camisa y suéter', 0.96], ['Traje completo', 1.0], ['Abrigo de invierno', 1.5]
  ];

  const S = { table: null, records: null, hasTime: false, timeOnly: false, sel: 0, series: null, key: '', timer: null };

  /* ---------- carga de datos ---------- */
  function fillSelects(m) {
    const opts = none => (none ? '<option value="-1">— ninguna —</option>' : '') +
      S.table.headers.map((h, j) => `<option value="${j}">${h}</option>`).join('');
    [['c_date', 'date', true], ['c_ta', 'ta', false], ['c_rh', 'rh', false], ['c_tr', 'tr', true], ['c_v', 'v', true], ['c_trm', 'trm', true]]
      .forEach(([id, k, none]) => { const s = $(id); s.innerHTML = opts(none); s.value = String(m[k]); });
  }
  // Aplica unos registros ya validados al estado y a los controles.
  function apply(res) {
    S.records = res.records; S.hasTime = res.hasTime; S.timeOnly = res.timeOnly; S.series = null;
    const hasTr = S.records.some(o => isFinite(o.tr)), hasV = S.records.some(o => isFinite(o.v));
    $('v_csv').disabled = !hasV; if (!hasV) $('v_csv').checked = false;
    [...$('tr_mode').options].forEach(op => { if (op.value === 'csv') op.disabled = !hasTr; });
    if (!hasTr && $('tr_mode').value === 'csv') $('tr_mode').value = 'slider';
    const hasTrm = S.records.some(o => isFinite(o.trm));
    [...$('trm_mode').options].forEach(op => { if (op.value === 'csv') op.disabled = !hasTrm; });
    $('trm_mode').value = hasTrm ? 'csv' : 'slider';
    S.sel = Math.min(S.sel, S.records.length - 1);
    $('idx').max = S.records.length - 1;
  }
  const mapFromSelects = () => { const g = id => +$(id).value; return { date: g('c_date'), ta: g('c_ta'), rh: g('c_rh'), tr: g('c_tr'), v: g('c_v'), trm: g('c_trm') }; };

  function setMsg(kind, text) {
    const err = $('err'), info = $('info');
    err.style.display = kind === 'err' ? 'block' : 'none';
    info.style.display = kind === 'ok' || kind === 'warn' ? 'block' : 'none';
    if (kind === 'err') err.textContent = text;
    else if (text) { info.textContent = text; info.className = 'info ' + kind; }
  }
  const showError = e => setMsg('err', e.message);

  // Valida y carga un texto CSV. Si algo falla, se conserva lo que ya estaba cargado.
  function load(text, name) {
    try {
      CSV.checkText(text);
      const table = CSV.parse(text), map = CSV.detect(table);
      CSV.checkColumns(table, map);
      const res = CSV.toRecords(table, map);
      S.table = table; fillSelects(map); S.sel = 0; apply(res);
      $('fname').textContent = name + ' · ' + S.records.length + ' registros';
      const dropped = res.skipped.nonNumeric + res.skipped.outOfRange;
      if (dropped) setMsg('warn', '⚠ ' + dropped + ' fila(s) descartada(s): ' + res.skipped.nonNumeric + ' sin valores numéricos y ' +
        res.skipped.outOfRange + ' fuera de rango (temperatura −40 a 60 °C, HR 0 a 100 %).');
      else if (map.guessed) setMsg('warn', '⚠ No se reconocieron los nombres de columna; se asumió "' + table.headers[map.ta] + '" como temperatura y "' + table.headers[map.rh] + '" como humedad. Revisalo en "Columnas detectadas".');
      else setMsg('ok', '✓ Archivo válido: ' + S.records.length + ' registros.');
      stop(); render();
    } catch (e) { showError(e); }
  }
  function remap() {
    try { apply(CSV.toRecords(S.table, mapFromSelects())); setMsg('none'); render(); } catch (e) { showError(e); }
  }

  /* ---------- parámetros ---------- */
  function params() {
    const f = id => { const x = parseFloat($(id + '_n').value); return isFinite(x) ? Math.min(FIELDS[id][1], Math.max(FIELDS[id][0], x)) : NaN; };
    return { met: f('met'), clo: f('clo'), v: f('v'), tr: f('tr'), trm: f('trm'), trMode: $('tr_mode').value, trmMode: $('trm_mode').value, vCsv: $('v_csv').checked, vAct: $('v_act').checked };
  }
  // Entradas de un registro: velocidad medida (CSV o manual) y MRT independiente de Ta (Ta solo se usa como MRT si el usuario lo elige).
  // Las correcciones por actividad (Vr, Icl,d) las aplica Comfort.evaluate una sola vez, igual que CBE.
  function env(o, p) {
    return { vBase: p.vCsv && isFinite(o.v) ? o.v : p.v,
             tr: p.trMode === 'ta' ? o.ta : (p.trMode === 'csv' && isFinite(o.tr) ? o.tr : p.tr),
             trm: p.trmMode === 'csv' && isFinite(o.trm) ? o.trm : p.trm };
  }
  const evalPoint = (ta, e, rh, p, skipSet) => Comfort.evaluate(ta, e.tr, e.vBase, rh, p.met, p.clo, { selfAirSpeed: p.vAct, skipSet });
  function computeSeries(p) {
    const R = S.records, key = [p.met, p.clo, p.v, p.tr, p.trMode, p.vCsv, p.vAct, R.length, R[0].ta, R[R.length - 1].ta].join('|');
    if (S.series && key === S.key) return;
    S.series = R.map(o => evalPoint(o.ta, env(o, p), o.rh, p, true));
    S.key = key;
  }

  /* ---------- render ---------- */
  const pmvColor = x => {
    const S_ = Charts.SCALE, t = Math.max(0, Math.min(1, (x + 3) / 6));
    for (let i = 1; i < S_.length; i++) if (t <= S_[i][0]) {
      const [t0, c0] = S_[i - 1], [t1, c1] = S_[i], u = (t - t0) / (t1 - t0);
      const h = s => [1, 3, 5].map(k => parseInt(s.substr(k, 2), 16));
      const a = h(c0), b = h(c1);
      return 'rgb(' + a.map((v, k) => Math.round(v + (b[k] - v) * u)).join(',') + ')';
    }
    return S_[S_.length - 1][1];
  };
  // Formato de presentación (el cálculo conserva toda la precisión): sgn/fixed con decimales fijos; num recorta ceros finales.
  const sgn = (x, d) => (x >= 0 ? '+' : '') + x.toFixed(d);
  const num = (x, d) => String(+x.toFixed(d));

  function render() {
    if (!S.records) return;
    const p = params();
    if ([p.met, p.clo, p.v, p.tr, p.trm].some(x => !isFinite(x))) return;
    computeSeries(p);
    const R = S.records, n = R.length, o = R[S.sel], e = env(o, p), r = evalPoint(o.ta, e, o.rh, p, false);
    S.series[S.sel] = r;
    const pmv = S.series.map(x => x.pmv), ppd = S.series.map(x => x.ppd);
    const ok = Math.abs(r.pmv) <= Comfort.LIMIT;

    $('v_n').disabled = $('v_r').disabled = p.vCsv;
    $('v_note').textContent = 'Medida: ' + num(e.vBase, 4) + ' m/s · Relativa: ' + num(e.vBase, 4) + ' + ' + num(r.vr - e.vBase, 4) + ' = ' + num(r.vr, 4) + ' m/s';
    $('clo_note').textContent = 'Original: ' + num(p.clo, 4) + ' clo · Dinámico: ' + num(r.cloD, 4) + ' clo' + (p.met > 1.2 ? '' : ' (sin corrección, met ≤ 1.2)');
    $('tr_n').disabled = $('tr_r').disabled = p.trMode !== 'slider';
    $('trm_n').disabled = $('trm_r').disabled = p.trmMode !== 'slider';
    syncPresets(p);

    $('idx').value = S.sel;
    $('idx_o').textContent = (S.sel + 1) + ' / ' + n;
    $('r_t').textContent = o.label;
    $('r_ta').textContent = num(o.ta, 3) + ' °C';
    $('r_rh').textContent = num(o.rh, 2) + ' %';
    $('r_tr').textContent = num(e.tr, 3) + ' °C';
    $('r_v').textContent = num(r.vr, 4) + ' m/s';
    $('r_met').textContent = num(p.met, 3);
    $('r_clo').textContent = r.cloD === p.clo ? num(p.clo, 4) : num(p.clo, 4) + ' → ' + num(r.cloD, 4);

    $('r_pmv').textContent = sgn(r.pmv, 4);
    $('r_ppd').textContent = r.ppd.toFixed(3) + ' %';
    $('r_sens').textContent = Comfort.sensation(r.pmv);
    $('r_set').textContent = r.set.toFixed(3) + ' °C';
    $('t_pmv').style.borderColor = pmvColor(r.pmv);
    const st = $('status');
    st.className = 'status ' + (ok ? 'ok' : 'no');
    st.textContent = ok ? '✓ Dentro de la zona de confort (|PMV| ≤ 0.5)'
      : '✕ Fuera de la zona de confort (' + (r.pmv > 0 ? 'calor' : 'frío') + ')';

    // Zona de confort en el gráfico «temperatura del aire»: Ta varía, la MRT queda fija en la del registro (como CBE).
    const zone = Psychro.comfortZone((db, rh) => evalPoint(db, e, rh, p, true).pmv, Comfort.LIMIT);
    const info = { label: o.label, ta: o.ta, rh: o.rh, tr: e.tr, v: r.vr, met: p.met, clo: p.clo, pmv: r.pmv, ppd: r.ppd };
    const common = { info, view: $('psy_view').value, records: R, pmv, ppd, sel: S.sel, hasTime: S.hasTime, timeOnly: S.timeOnly };
    const onSelect = i => { stop(); go(i); };
    Charts.psychro($('psy'), $('psy-box'), Object.assign({ zone, onSelect }, common));
    Charts.timeseries($('ts'), common);
    Charts.pie($('pie'), common);
    renderAdaptive(p, onSelect);
  }

  /* ---------- método adaptativo (ASHRAE 55-2023) ---------- */
  const SENS = { ok: ['Confortable', ''], cool: ['Demasiado fresco', '#2f6fb5'], warm: ['Demasiado cálido', 'var(--hot)'] };
  function renderAdaptive(p, onSelect) {
    const R = S.records, n = R.length;
    const A = R.map(q => { const e = env(q, p); return Adaptive.evaluate(q.ta, e.tr, e.trm, e.vBase); });
    const a = A[S.sel], o = R[S.sel], e = env(o, p);
    const rng = (lo, hi) => lo.toFixed(1) + ' – ' + hi.toFixed(1) + ' °C';
    $('a_to').textContent = num(a.to, 2) + ' °C';
    $('a_trm').textContent = num(a.trm, 2) + ' °C';
    $('a_l80').textContent = rng(a.l80, a.u80);
    $('a_l90').textContent = rng(a.l90, a.u90);
    [['a_s80', a.s80], ['a_s90', a.s90]].forEach(([id, k]) => { $(id).textContent = SENS[k][0]; $(id).style.color = SENS[k][1]; });
    const st = $('adp_status');
    st.className = 'status ' + (a.complies ? 'ok' : 'no');
    st.textContent = a.complies ? '✓ Cumple con ASHRAE Standard 55-2023' : '✕ No cumple con ASHRAE Standard 55-2023';
    const msg = [];
    if (!a.inRange) msg.push('↳ Temperaturas medias exteriores predominantes por encima de 33.5 °C o por debajo de 10 °C no están cubiertas por la norma 55.');
    if (a.to < 25 && e.vBase > 0.3) msg.push('El efecto de enfriamiento de la velocidad del aire se usa solo cuando la temperatura operativa supera 25 °C.');
    const n80 = A.filter(x => x.inRange && x.acc80).length, n90 = A.filter(x => x.inRange && x.acc90).length;
    msg.push('Serie completa: ' + n80 + ' de ' + n + ' registros dentro del 80 % (' + (100 * n80 / n).toFixed(0) + ' %) · ' + n90 + ' dentro del 90 % (' + (100 * n90 / n).toFixed(0) + ' %).');
    $('adp_msg').textContent = msg.join('\n');
    const f = (x, d) => x.toFixed(d);
    const lines = ['Hora = ' + o.label, 'Ta = ' + f(o.ta, 1) + ' C°', 'MRT = ' + f(e.tr, 2) + ' C°', 'Top = ' + f(a.to, 2) + ' C°',
      'Trm = ' + f(a.trm, 1) + ' C°', 'Vel = ' + f(e.vBase, 2) + ' m/s', 'Límite 80 % = ' + rng(a.l80, a.u80), 'Límite 90 % = ' + rng(a.l90, a.u90)];
    Charts.adaptive($('adp'), $('adp-box'), { records: R, series: A, sel: S.sel, lines, onSelect });
  }

  /* ---------- descarga comparativa: psicrométrico + adaptativo en una sola imagen ---------- */
  async function downloadBoth() {
    const btn = $('dl_both'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generando…';
    try {
      const W = 1000, H = 720, opt = { format: 'png', width: W, height: H, scale: 2 };
      const [ua, ub] = await Promise.all([Plotly.toImage($('psy'), opt), Plotly.toImage($('adp'), opt)]);
      const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const pad = 48, head = 150, c = document.createElement('canvas');
      c.width = ia.width + ib.width + pad * 3; c.height = head + Math.max(ia.height, ib.height) + pad;
      const g = c.getContext('2d'), rec = S.records[S.sel];
      g.fillStyle = css('--card'); g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = css('--ink'); g.textBaseline = 'top';
      g.font = '600 44px system-ui, sans-serif'; g.fillText('Comparativo de confort térmico · registro ' + rec.label, pad, 28);
      g.fillStyle = css('--muted'); g.font = '34px system-ui, sans-serif';
      g.fillText('Izquierda: PMV / PPD en el gráfico psicrométrico   ·   Derecha: método adaptativo (ASHRAE 55-2023)', pad, 90);
      g.drawImage(ia, pad, head); g.drawImage(ib, ia.width + pad * 2, head);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'comparativo_' + rec.label.replace(/[^\w-]+/g, '_') + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { showError(new Error('No se pudo generar la imagen: ' + (err.message || err))); }
    btn.disabled = false; btn.textContent = label;
  }

  /* ---------- presets (actividad / ropa) ---------- */
  function fillPresets() {
    const mk = (id, list, unit) => {
      $(id).innerHTML = list.map(([name, v], i) => `<option value="${v}">${name} · ${v} ${unit}</option>`).join('') +
        '<option value="custom">Personalizado</option>';
    };
    mk('met_p', ACTIVITIES, 'met'); mk('clo_p', CLOTHING, 'clo');
  }
  function syncPresets(p) {
    [['met_p', p.met], ['clo_p', p.clo]].forEach(([id, val]) => {
      const sel = $(id), hit = [...sel.options].find(op => op.value !== 'custom' && Math.abs(+op.value - val) < 1e-9);
      sel.value = hit ? hit.value : 'custom';
    });
  }

  /* ---------- eventos ---------- */
  let raf = 0, deb = 0;
  const queue = () => {
    cancelAnimationFrame(raf); clearTimeout(deb);
    if (S.records && S.records.length > 1500) deb = setTimeout(render, 250); else raf = requestAnimationFrame(render);
  };
  function stop() { if (S.timer) { clearInterval(S.timer); S.timer = null; } $('play').classList.remove('on'); $('play').textContent = '▶'; }
  function go(i) { if (!S.records) return; S.sel = (i + S.records.length) % S.records.length; render(); }

  ['met', 'clo', 'v', 'tr', 'trm'].forEach(id => {
    const n = $(id + '_n'), r = $(id + '_r');
    n.addEventListener('input', () => { if (isFinite(parseFloat(n.value))) r.value = n.value; queue(); });
    n.addEventListener('change', () => {
      let x = parseFloat(n.value); const [lo, hi] = FIELDS[id];
      if (!isFinite(x)) x = parseFloat(r.value);
      n.value = Math.min(hi, Math.max(lo, x)); r.value = n.value; queue();
    });
    r.addEventListener('input', () => { n.value = r.value; queue(); });
  });
  ['met', 'clo'].forEach(id => $(id + '_p').addEventListener('change', e => {
    if (e.target.value === 'custom') return;
    $(id + '_n').value = e.target.value; $(id + '_r').value = e.target.value; queue();
  }));
  ['v_csv', 'v_act', 'tr_mode', 'trm_mode', 'psy_view'].forEach(id => $(id).addEventListener('change', queue));
  ['c_date', 'c_ta', 'c_rh', 'c_tr', 'c_v', 'c_trm'].forEach(id => $(id).addEventListener('change', remap));

  $('idx').addEventListener('input', e => { stop(); go(+e.target.value); });
  $('prev').addEventListener('click', () => { stop(); go(S.sel - 1); });
  $('next').addEventListener('click', () => { stop(); go(S.sel + 1); });
  $('play').addEventListener('click', () => {
    if (S.timer) return stop();
    $('play').classList.add('on'); $('play').textContent = '❚❚';
    S.timer = setInterval(() => go(S.sel + 1), 800);
  });
  document.addEventListener('keydown', e => {
    const a = document.activeElement;
    if (/INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== 'range') return;
    if (e.key === 'ArrowRight') { stop(); go(S.sel + 1); } else if (e.key === 'ArrowLeft') { stop(); go(S.sel - 1); }
  });

  function readFile(f, extra) {
    try { CSV.checkFile(f); } catch (e) { return showError(e); }
    const xl = /\.xls[xm]?$/i.test(f.name), r = new FileReader();
    r.onerror = () => showError(new Error('No se pudo leer el archivo.'));
    r.onload = () => {
      let text;
      try { text = xl ? window.Sheet.toText(r.result) : String(r.result); } catch (e) { return showError(e); }
      load(text, f.name);
      if (extra) $('info').textContent += ' (se ignoraron ' + extra + ' archivo(s) adicional(es))';
    };
    if (xl) r.readAsArrayBuffer(f); else r.readAsText(f);
  }
  $('file').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
  $('sample').addEventListener('click', () => load(window.SAMPLE_CSV, 'ejemplo (TEMP MIN Y HUM MAX.csv)'));
  $('dl_both').addEventListener('click', downloadBoth);
  $('tpl_xlsx').addEventListener('click', () => {
    try { window.Sheet.downloadTemplate(); } catch (e) { showError(e); }
  });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const fl = e.dataTransfer.files; if (fl[0]) readFile(fl[0], fl.length - 1); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queue);

  fillPresets();
  load(window.SAMPLE_CSV, 'ejemplo (TEMP MIN Y HUM MAX.csv)');
})();
