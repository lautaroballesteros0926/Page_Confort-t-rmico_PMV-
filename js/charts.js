/* Gráficos Plotly: psicrométrico (estilo CBE), PMV en el tiempo y % en confort. */
(function (G) {
  'use strict';
  const PS = G.Psychro;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const SCALE = [[0, '#2166ac'], [0.25, '#67a9cf'], [0.42, '#a8dcc4'], [0.5, '#8bd3b0'], [0.58, '#f3c9a6'], [0.75, '#e0794f'], [1, '#a31b2c']];
  const CFG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'] };
  const GREEN = '#2e9d73', RED = '#e53935';

  const theme = () => ({ ink: css('--ink'), muted: css('--muted'), grid: css('--grid'), rh: css('--rhline'), card: css('--card'), region: css('--region') });
  const base = t => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: t.ink, family: 'system-ui, sans-serif', size: 12 } });

  /* ---------- psicrométrico ---------- */
  let ro = null; // estado para la caja de valores bajo el cursor

  function showBox(box, x, y, caption) {
    const w = y, rh = PS.rhFrom(x, w);
    const row = (k, v, u) => `<div><span>${k}</span><b>${v}</b><i>${u}</i></div>`;
    box.innerHTML = `<small>${caption}</small>` +
      row('t<sub>bs</sub>', x.toFixed(1), '°C') + row('HR', rh.toFixed(1), '%') +
      row('W', w.toFixed(1), 'g/kg') + row('t<sub>bh</sub>', PS.wetBulb(x, w).toFixed(1), '°C') +
      row('t<sub>rocío</sub>', PS.dewPoint(w).toFixed(1), '°C') + row('h', PS.enthalpy(x, w).toFixed(1), 'kJ/kg');
  }

  function psychro(el, box, o) {
    const t = theme(), R = o.records;
    const xs = R.map(r => r.ta), Wg = R.map(r => PS.humRatio(r.ta, r.rh)), Wk = Wg.map(w => w / 1000);
    const full = o.view !== 'zoom';
    const xmin = full ? -20 : Math.min(10, Math.floor(Math.min(...xs)) - 1);
    const xmax = full ? 50 : Math.max(36, Math.ceil(Math.max(...xs)) + 1);
    const ymax = Math.max(0.03, Math.ceil(Math.max(...Wk) * 200) / 200 + 0.005);   // kg/kg
    const sat = x => PS.humRatio(x, 100) / 1000;
    const step = full ? 1 : 0.5;
    const line = (color, width) => ({ mode: 'lines', hoverinfo: 'skip', showlegend: false, line: { color, width } });
    const tr = [];

    // región bajo la curva de saturación
    const sx = [], sy = [];
    for (let x = xmin; x <= xmax + 1e-9; x += step) { sx.push(x); sy.push(sat(x)); }
    tr.push({ x: [xmin].concat(sx, [xmax]), y: [0].concat(sy, [0]), fill: 'toself', mode: 'none', fillcolor: t.region, hoverinfo: 'skip', showlegend: false });

    // rejilla: bulbo seco (vertical), humedad absoluta (horizontal), entalpía (diagonal)
    const gx = [], gy = [], notes = [];
    const dtv = full ? 5 : 2;
    for (let x = Math.ceil(xmin / dtv) * dtv; x <= xmax; x += dtv) { gx.push(x, x, null); gy.push(0, Math.min(sat(x), ymax), null); }
    for (let w = 0.005; w <= ymax + 1e-9; w += 0.005) {
      const x0 = Math.max(xmin, PS.satTemp(w * 1000)); gx.push(x0, xmax, null); gy.push(w, w, null);
    }
    for (let h = 0; h <= 150; h += 10) {
      const wOf = x => (h - 1.006 * x) / (2501 + 1.86 * x);
      // punto de inicio: saturación (o borde superior si queda fuera)
      let xs0 = bisectT(x => sat(x) - wOf(x), -40, 80);
      let w0 = sat(xs0);
      if (w0 > ymax) { xs0 = (h - 2501 * ymax) / (1.006 + 1.86 * ymax); w0 = ymax; }
      const xe = Math.min(h / 1.006, xmax);
      if (xe <= xs0 || xs0 > xmax || xe < xmin) continue;
      for (let k = 0; k <= 12; k++) { const x = xs0 + (xe - xs0) * k / 12; gx.push(x); gy.push(Math.max(0, wOf(x))); }
      gx.push(null); gy.push(null);
      if (xs0 >= xmin && xs0 <= xmax)
        notes.push({ x: xs0, y: w0, text: h + ' kJ/kg', xanchor: 'right', yanchor: w0 >= ymax ? 'bottom' : 'middle', xshift: -3, font: { size: 10, color: t.muted } });
    }
    tr.push(line(t.muted, 0.6)); Object.assign(tr[tr.length - 1], { x: gx, y: gy });

    // curvas de HR
    const rx = [], ry = [];
    for (let rh = 10; rh < 100; rh += 10) {
      for (let x = xmin; x <= xmax + 1e-9; x += step) { rx.push(x); ry.push(PS.humRatio(x, rh) / 1000); }
      rx.push(null); ry.push(null);
      // rótulo: arriba si la curva sale por el borde superior, si no sobre el borde derecho
      const xc = bisectT(x => PS.humRatio(x, rh) / 1000 - ymax, -40, 85);
      if (xc <= xmax - 1) notes.push({ x: xc, y: ymax, text: rh + '%', yanchor: 'bottom', xanchor: 'center', yshift: 2, font: { size: 10, color: t.muted } });
      else notes.push({ x: xmax, y: PS.humRatio(xmax, rh) / 1000, text: rh + '%', xanchor: 'right', yanchor: 'bottom', xshift: -4, font: { size: 10, color: t.muted } });
    }
    tr.push(line(t.ink, 0.9)); Object.assign(tr[tr.length - 1], { x: rx, y: ry });
    tr.push(line(t.ink, 1.8)); Object.assign(tr[tr.length - 1], { x: sx, y: sy });   // 100 %

    // zona de confort (contorno verde)
    tr.push({ x: o.zone.x, y: o.zone.y.map(w => w / 1000), mode: 'lines', fill: 'toself', name: 'Zona de confort', hoverinfo: 'skip',
      fillcolor: 'rgba(46,190,60,0.10)', line: { color: '#27c13a', width: 3 } });

    // registros
    tr.push({ x: xs, y: Wk, mode: 'lines', showlegend: false, hoverinfo: 'skip', line: { color: t.muted, width: 0.8, dash: 'dot' }, opacity: 0.5 });
    tr.push({ x: xs, y: Wk, mode: 'markers', name: 'Registros',
      marker: { size: 7, color: o.pmv, colorscale: SCALE, cmin: -3, cmax: 3, opacity: 0.7, line: { width: 0.6, color: 'rgba(0,0,0,.4)' },
        colorbar: { title: { text: 'PMV' }, thickness: 10, len: 0.6, x: 1.1, tickvals: [-3, -2, -1, 0, 1, 2, 3], outlinewidth: 0 } },
      customdata: R.map((r, i) => [r.label, r.rh, o.pmv[i], o.ppd[i]]),
      hovertemplate: '%{customdata[0]}<br>Ta %{x:.1f} °C · HR %{customdata[1]:.0f} %<br>PMV %{customdata[2]:+.2f} · PPD %{customdata[3]:.0f} %<extra></extra>' });

    // punto rojo seleccionado
    tr.push({ x: [xs[o.sel]], y: [Wk[o.sel]], mode: 'markers', hoverinfo: 'skip', name: 'Seleccionado',
      marker: { size: 16, color: '#e5261f', line: { width: 2, color: '#7a0b07' } } });

    const axis = { showgrid: false, zeroline: false, showline: true, linecolor: t.ink, ticks: 'outside', tickcolor: t.ink };
    Plotly.react(el, tr, Object.assign({}, base(t), { paper_bgcolor: t.card, plot_bgcolor: t.card,
      xaxis: Object.assign({ title: 'Temperatura de bulbo seco [°C]', range: [xmin, xmax], dtick: full ? 5 : 2 }, axis),
      yaxis: Object.assign({ title: 'Humedad absoluta [kg/kg]', range: [0, ymax], side: 'right', dtick: 0.005, tickformat: '.3f' }, axis),
      annotations: notes.map(a => Object.assign({ showarrow: false }, a)).concat([infoBlock(o.info, t)]),
      showlegend: true, legend: { orientation: 'h', x: 0, y: 1.07 }, margin: { l: 24, r: 100, t: 34, b: 54 }
    }), Object.assign({}, CFG, { toImageButtonOptions: { format: 'png', filename: 'psicrometrico_' + o.info.label.replace(/[^\w-]+/g, '_'), scale: 2 } })).then(gd => {
      const s = o.sel;
      ro = { box, def: () => showBox(box, xs[s], Wg[s], 'Registro ' + R[s].label) };
      ro.def();
      if (!gd._bound) {
        gd._bound = true;
        gd.on('plotly_click', ev => {
          const p = ev.points.find(q => q.data.name === 'Registros');
          if (p && o.onSelect) o.onSelect(p.pointIndex);
        });
      }
      const drag = gd.querySelector('.nsewdrag');
      if (drag && !drag._ro) {
        drag._ro = true;
        drag.addEventListener('mousemove', e => {
          const bb = drag.getBoundingClientRect(), L = gd._fullLayout;
          ro.box.style.display = 'block'; showBox(ro.box, L.xaxis.p2d(e.clientX - bb.left), Math.max(0, L.yaxis.p2d(e.clientY - bb.top) * 1000), 'Cursor');
        });
        drag.addEventListener('mouseleave', () => { ro.box.style.display = 'none'; });
      }
    });
  }

  // Bloque de texto con los valores del registro (queda incluido al descargar el gráfico)
  function infoBlock(i, t) {
    const f = (x, d) => x.toFixed(d);
    const lines = ['Hora = ' + i.label, 'Ta = ' + f(i.ta, 1) + ' C°', 'RH = ' + f(i.rh, 0) + ' %', 'MRT = ' + f(i.tr, 2) + ' C°',
      'Vel = ' + f(i.v, 2) + ' m/s', 'Met = ' + f(i.met, 1), 'Clo = ' + f(i.clo, 2), 'PMV = ' + f(i.pmv, 3), 'PPD = ' + f(i.ppd, 2) + ' %'];
    return { xref: 'paper', yref: 'paper', x: 0.005, y: 0.985, xanchor: 'left', yanchor: 'top', align: 'left', showarrow: false,
      text: lines.join('<br>'), font: { size: 16, color: t.ink } };
  }

  function bisectT(f, a, b) { // f creciente en t
    for (let i = 0; i < 30; i++) { const c = (a + b) / 2; if (f(c) < 0) a = c; else b = c; }
    return (a + b) / 2;
  }

  /* ---------- adaptativo ASHRAE 55-2023 ---------- */
  let roA = null;

  function showBoxA(box, x, y, caption) {
    const row = (k, v, u) => `<div><span>${k}</span><b>${v}</b><i>${u}</i></div>`;
    box.innerHTML = `<small>${caption}</small>` + row('T<sub>rm</sub>', x.toFixed(1), '°C') + row('T<sub>op</sub>', y.toFixed(1), '°C');
  }

  // o: { records, series (Adaptive.evaluate por registro), sel, lines (texto del bloque), onSelect }
  function adaptive(el, box, o) {
    const t = theme(), AD = G.Adaptive, R = o.records, A = o.series, s = A[o.sel];
    const xs = A.map(a => a.trm), ys = A.map(a => a.to);
    const xmin = Math.min(AD.TRM_MIN, Math.floor(Math.min(...xs)) - 1), xmax = Math.max(AD.TRM_MAX, Math.ceil(Math.max(...xs)) + 1);
    const ymin = Math.min(AD.TOP_MIN, Math.floor(Math.min(...ys)) - 1), ymax = Math.max(AD.TOP_MAX, Math.ceil(Math.max(...ys)) + 1);
    const b = AD.bands(s.ce), tr = [];
    const GL = '#2e7d32';

    tr.push({ x: b.b80.x, y: b.b80.y, mode: 'lines', fill: 'toself', name: 'Aceptable 80 %', hoverinfo: 'skip',
      fillcolor: 'rgba(46,157,60,0.30)', line: { color: GL, width: 1 } });
    tr.push({ x: b.b90.x, y: b.b90.y, mode: 'lines', fill: 'toself', name: 'Aceptable 90 %', hoverinfo: 'skip',
      fillcolor: 'rgba(30,125,40,0.55)', line: { color: GL, width: 1 } });

    // registros
    tr.push({ x: xs, y: ys, mode: 'lines', showlegend: false, hoverinfo: 'skip', line: { color: t.muted, width: 0.8, dash: 'dot' }, opacity: 0.5 });
    tr.push({ x: xs, y: ys, mode: 'markers', name: 'Registros',
      marker: { size: 7, color: A.map(a => a.to - a.tcmf), colorscale: SCALE, cmin: -3.5, cmax: 3.5, opacity: 0.8, line: { width: 0.6, color: 'rgba(0,0,0,.4)' },
        colorbar: { title: { text: 'T<sub>op</sub> − T<sub>conf</sub> [K]' }, thickness: 10, len: 0.6, x: 1.1, outlinewidth: 0,
          tickvals: [-3.5, -2.5, 0, 2.5, 3.5], ticktext: ['−3.5', '−2.5', '0', '+2.5', '+3.5'] } },
      customdata: R.map((r, i) => [r.label, A[i].to - A[i].tcmf, A[i].acc90 ? '90 %' : (A[i].acc80 ? '80 %' : 'fuera')]),
      hovertemplate: '%{customdata[0]}<br>T<sub>rm</sub> %{x:.1f} °C · T<sub>op</sub> %{y:.1f} °C<br>T<sub>op</sub> − T<sub>conf</sub> %{customdata[1]:+.1f} K · aceptable: %{customdata[2]}<extra></extra>' });

    // punto rojo seleccionado
    tr.push({ x: [s.trm], y: [s.to], mode: 'markers', hoverinfo: 'skip', name: 'Seleccionado',
      marker: { size: 16, color: '#e5261f', line: { width: 2, color: '#7a0b07' } } });

    const axis = { showgrid: true, gridcolor: t.grid, zeroline: false, showline: true, linecolor: t.ink, ticks: 'outside', tickcolor: t.ink };
    const text = o.lines.join('<br>');
    Plotly.react(el, tr, Object.assign({}, base(t), { paper_bgcolor: t.card, plot_bgcolor: t.card,
      xaxis: Object.assign({ title: 'Temperatura media exterior predominante [°C]', range: [xmin, xmax], tick0: 10, dtick: 2 }, axis),
      yaxis: Object.assign({ title: 'Temperatura operativa [°C]', range: [ymin, ymax], dtick: 2 }, axis),
      annotations: [{ xref: 'paper', yref: 'paper', x: 0.005, y: 0.985, xanchor: 'left', yanchor: 'top', align: 'left', showarrow: false,
        text, font: { size: 16, color: t.ink } }],
      showlegend: true, legend: { orientation: 'h', x: 0, y: 1.07 }, margin: { l: 60, r: 100, t: 34, b: 54 }
    }), Object.assign({}, CFG, { toImageButtonOptions: { format: 'png', filename: 'adaptativo_' + R[o.sel].label.replace(/[^\w-]+/g, '_'), scale: 2 } })).then(gd => {
      roA = { box, def: () => showBoxA(box, s.trm, s.to, 'Registro ' + R[o.sel].label) };
      roA.def();
      if (!gd._bound) {
        gd._bound = true;
        gd.on('plotly_click', ev => {
          const p = ev.points.find(q => q.data.name === 'Registros');
          if (p && o.onSelect) o.onSelect(p.pointIndex);
        });
      }
      const drag = gd.querySelector('.nsewdrag');
      if (drag && !drag._ro) {
        drag._ro = true;
        drag.addEventListener('mousemove', e => {
          const bb = drag.getBoundingClientRect(), L = gd._fullLayout;
          roA.box.style.display = 'block'; showBoxA(roA.box, L.xaxis.p2d(e.clientX - bb.left), L.yaxis.p2d(e.clientY - bb.top), 'Cursor');
        });
        drag.addEventListener('mouseleave', () => { roA.box.style.display = 'none'; });
      }
    });
  }

  /* ---------- PMV en el tiempo ---------- */
  function timeseries(el, o) {
    const t = theme(), n = o.records.length, when = o.records.map(r => r.t);
    const x0 = when[0], x1 = when[n - 1], yM = Math.max(1.5, ...o.pmv.map(Math.abs)) + 0.3;
    Plotly.react(el, [
      { x: [x0, x1, x1, x0], y: [-0.5, -0.5, 0.5, 0.5], fill: 'toself', mode: 'lines', line: { width: 0 }, fillcolor: 'rgba(46,157,115,0.18)', hoverinfo: 'skip' },
      { x: when, y: o.pmv, mode: n > 150 ? 'lines' : 'lines+markers', line: { color: t.muted, width: 1.3 },
        marker: { size: 6, color: o.pmv, colorscale: SCALE, cmin: -3, cmax: 3, line: { width: 0.5, color: 'rgba(0,0,0,.3)' } },
        customdata: o.ppd, hovertemplate: 'PMV %{y:+.2f}<br>PPD %{customdata:.0f} %<extra></extra>' },
      { x: [when[o.sel]], y: [o.pmv[o.sel]], mode: 'markers', hoverinfo: 'skip', marker: { size: 13, color: RED, line: { width: 2, color: '#fff' } } }
    ], Object.assign({}, base(t), {
      margin: { l: 48, r: 12, t: 8, b: 44 }, showlegend: false,
      xaxis: Object.assign({ gridcolor: t.grid, zeroline: false, title: o.timeOnly ? 'Hora' : (o.hasTime ? 'Fecha' : 'Registro') }, o.timeOnly ? { tickformat: '%H:%M' } : {}),
      yaxis: { title: 'PMV', range: [-yM, yM], gridcolor: t.grid, zerolinecolor: t.muted }
    }), CFG);
  }

  /* ---------- % en confort ---------- */
  function pie(el, o) {
    const t = theme(), n = o.pmv.length;
    const cold = o.pmv.filter(x => x < -0.5).length, hot = o.pmv.filter(x => x > 0.5).length, ok = n - cold - hot;
    Plotly.react(el, [{
      type: 'pie', hole: 0.64, sort: false, direction: 'clockwise', textinfo: 'percent', textposition: 'outside',
      labels: ['Confort', 'Calor (PMV > 0.5)', 'Frío (PMV < −0.5)'], values: [ok, hot, cold],
      marker: { colors: [GREEN, '#c4452f', '#2f6fb5'], line: { color: t.card, width: 2 } },
      hovertemplate: '%{label}<br>%{value} registros · %{percent}<extra></extra>'
    }], Object.assign({}, base(t), {
      margin: { l: 16, r: 16, t: 16, b: 16 }, showlegend: true, legend: { orientation: 'h', y: -0.02, x: 0.5, xanchor: 'center' },
      annotations: [{ text: '<b>' + (100 * ok / n).toFixed(0) + '%</b><br><span style="font-size:12px">en confort</span>', showarrow: false, x: 0.5, y: 0.5, font: { size: 30, color: t.ink } }]
    }), CFG);
  }

  G.Charts = { psychro, adaptive, timeseries, pie, SCALE };
})(window);
