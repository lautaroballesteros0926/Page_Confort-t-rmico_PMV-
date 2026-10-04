/* Propiedades psicrométricas y frontera de la zona de confort. */
(function (G) {
  'use strict';
  const P = 101325;

  function psat(t) { // Pa
    const T = t + 273.15;
    return Math.exp(-5800.2206 / T + 1.3914993 - 0.048640239 * T + 4.1764768e-5 * T * T
      - 1.4452093e-8 * T * T * T + 6.5459673 * Math.log(T));
  }
  const humRatio = (t, rh) => { const pv = rh / 100 * psat(t); return 1000 * 0.622 * pv / (P - pv); }; // g/kg
  const rhFrom = (t, w) => { const pv = P * (w / 1000) / (0.622 + w / 1000); return Math.min(100, 100 * pv / psat(t)); };
  const enthalpy = (t, w) => 1.006 * t + (w / 1000) * (2501 + 1.86 * t); // kJ/kg

  function bisect(f, a, b, n) {
    for (let i = 0; i < n; i++) { const c = (a + b) / 2; if (f(c) < 0) a = c; else b = c; }
    return (a + b) / 2;
  }
  function dewPoint(w) {
    const pv = P * (w / 1000) / (0.622 + w / 1000);
    return bisect(t => psat(t) - pv, -40, 60, 30);
  }
  function wetBulb(t, w) {
    const f = twb => {
      const ws = 0.622 * psat(twb) / (P - psat(twb));
      const wc = ((2501 - 2.326 * twb) * ws - 1.006 * (t - twb)) / (2501 + 1.86 * t - 4.186 * twb);
      return wc * 1000 - w;
    };
    return bisect(f, -20, t, 30);
  }

  /* Zona de confort: |PMV| <= limit. Se resuelve, para cada curva de HR (0..100 %), la
     temperatura donde PMV = ±limit y se cierra con la curva de saturación.
     pmvAt(db, rh) debe devolver el PMV. */
  function comfortZone(pmvAt, limit) {
    const solve = (rh, target) => {
      const f = db => pmvAt(db, rh) - target;
      const lo = -10, hi = 50;
      if (f(lo) > 0) return lo;
      if (f(hi) < 0) return hi;
      return bisect(f, lo, hi, 12);
    };
    const pts = [];
    for (let rh = 0; rh <= 100; rh += 10) { const t = solve(rh, -limit); pts.push([t, humRatio(t, rh)]); }
    const tTop = solve(100, limit), tMin = solve(100, -limit);
    for (let t = tMin; t <= tTop; t += 0.5) pts.push([t, humRatio(t, 100)]);
    pts.push([tTop, humRatio(tTop, 100)]);
    for (let rh = 100; rh >= 0; rh -= 10) { const t = solve(rh, limit); pts.push([t, humRatio(t, rh)]); }
    return { x: pts.map(p => p[0]), y: pts.map(p => p[1]) };
  }

    // temperatura de saturación para una humedad absoluta w [g/kg]
  const satTemp = w => bisect(t => humRatio(t, 100) - w, -40, 80, 30);

  G.Psychro = { satTemp, psat, humRatio, rhFrom, enthalpy, dewPoint, wetBulb, comfortZone };
})(window);
