/* Método adaptativo ASHRAE 55-2023: mismos cálculos que CBE Thermal Comfort Tool (comf.adaptiveComfortASH55 y calcAdaptiveCompliance). */
(function (G) {
  'use strict';

  const TRM_MIN = 10, TRM_MAX = 33.5;      // rango de aplicabilidad de la temp. media exterior predominante [°C]
  const TOP_MIN = 14, TOP_MAX = 35;        // rango del eje vertical del gráfico [°C]
  const SLOPE = 0.31, OFFSET = 17.8;       // T_conf = 0.31·Trm + 17.8
  const W80 = 3.5, W90 = 2.5;              // semiancho de las bandas de aceptabilidad 80 % y 90 % [K]

  // Efecto de enfriamiento por velocidad media del aire (Tabla 5.4.2.4: 0.6 → 1.2, 0.9 → 1.8, 1.2 → 2.2 K).
  const coolingEffect = v => (v >= 1.2 ? 2.2 : v >= 0.9 ? 1.8 : v >= 0.6 ? 1.2 : 0);

  // ta, tr: temperatura del aire y radiante media [°C]; trm: temp. media exterior predominante [°C]; v: velocidad del aire [m/s].
  function evaluate(ta, tr, trm, v) {
    const to = (ta + tr) / 2;                                   // temperatura operativa (igual que CBE)
    const tcmf = SLOPE * trm + OFFSET;
    // El efecto de enfriamiento solo aplica con v > 0.3 m/s y Top ≥ 25 °C, y solo si el límite superior base es ≥ 25 °C.
    const ce = v > 0.3 && to >= 25 ? coolingEffect(v) : 0;
    const u80b = tcmf + W80, u90b = tcmf + W90;
    const r = { to, trm, tcmf, ce, v,
      l80: tcmf - W80, u80: u80b + (u80b >= 25 ? ce : 0),
      l90: tcmf - W90, u90: u90b + (u90b >= 25 ? ce : 0) };
    r.acc90 = to >= r.l90 && to <= r.u90;
    r.acc80 = r.acc90 || (to >= r.l80 && to <= r.u80);
    r.inRange = trm >= TRM_MIN && trm <= TRM_MAX;
    r.complies = r.inRange && r.acc80;
    // Sensación: 'ok' | 'cool' | 'warm' para cada nivel de aceptabilidad
    const side = lo => (to < lo ? 'cool' : 'warm');
    r.s80 = r.acc80 ? 'ok' : side(r.l80);
    r.s90 = r.acc90 ? 'ok' : side(r.l90);
    return r;
  }

  // Polígonos cerrados (x = Trm, y = Top) de las bandas 80 % y 90 % para un efecto de enfriamiento dado.
  function bands(ce) {
    const poly = w => {
      const up = x => SLOPE * x + OFFSET + w, lo = x => SLOPE * x + OFFSET - w;
      const x = [TRM_MIN], y = [up(TRM_MIN)];
      if (ce > 0) {
        const xs = (25 - OFFSET - w) / SLOPE;                     // Trm donde el límite superior base llega a 25 °C
        x.push(xs, xs, TRM_MAX); y.push(25, 25 + ce, up(TRM_MAX) + ce);
      } else { x.push(TRM_MAX); y.push(up(TRM_MAX)); }
      x.push(TRM_MAX, TRM_MIN, TRM_MIN); y.push(lo(TRM_MAX), lo(TRM_MIN), up(TRM_MIN));
      return { x, y };
    };
    return { b80: poly(W80), b90: poly(W90) };
  }

  G.Adaptive = { evaluate, bands, coolingEffect, TRM_MIN, TRM_MAX, TOP_MIN, TOP_MAX };
})(window);
