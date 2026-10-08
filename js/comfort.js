/* Modelo de confort térmico: PMV de Fanger + SET de Gagge (dos nodos), con el mismo procedimiento que CBE Thermal Comfort Tool (ASHRAE 55-2023). */
(function (G) {
  'use strict';

  const ppdFromPmv = pmv => 100 - 95 * Math.exp(-0.03353 * Math.pow(pmv, 4) - 0.2179 * pmv * pmv);
  const satTorr = t => Math.exp(18.6686 - 4030.183 / (t + 235));

  function fanger(ta, tr, v, rh, met, clo) {
    const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));
    const icl = 0.155 * clo, m = met * 58.15, mw = m;
    const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
    const hcf = 12.1 * Math.sqrt(v), taa = ta + 273, tra = tr + 273;
    const tcla = taa + (35.5 - ta) / (3.5 * icl + 0.1);
    const p1 = icl * fcl, p2 = p1 * 3.96, p3 = p1 * 100, p4 = p1 * taa;
    const p5 = 308.7 - 0.028 * mw + p2 * Math.pow(tra / 100, 4);
    let xn = tcla / 100, xf = tcla / 50, n = 0, hc = hcf;
    while (Math.abs(xn - xf) > 0.00015 && n++ < 150) {
      xf = (xf + xn) / 2;
      hc = Math.max(hcf, 2.38 * Math.pow(Math.abs(100 * xf - taa), 0.25));
      xn = (p5 + p4 * hc - p2 * Math.pow(xf, 4)) / (100 + p3 * hc);
    }
    const tcl = 100 * xn - 273;
    const hl1 = 0.00305 * (5733 - 6.99 * mw - pa);
    const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
    const hl3 = 1.7e-5 * m * (5867 - pa);
    const hl4 = 0.0014 * m * (34 - ta);
    const hl5 = 3.96 * fcl * (Math.pow(xn, 4) - Math.pow(tra / 100, 4));
    const hl6 = fcl * hc * (tcl - ta);
    return (0.303 * Math.exp(-0.036 * m) + 0.028) * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6);
  }

  /* ---------- Procedimiento de CBE Thermal Comfort Tool (comfort-models.js) ----------
     Portado de https://comfort.cbe.berkeley.edu/static/js/comfort-models.js */
  const P_ATM = 101325;          // Pa (psy.PROP.Patm)
  const STILL_AIR = 0.1;         // m/s

  // Velocidad relativa: Vr = Va + 0.3·(M − 1) si M > 1 met (y la opción de velocidad por actividad está activa).
  const relativeSpeed = (va, met, self = true) => (self && met > 1 ? va + 0.3 * (met - 1) : va);
  // Aislamiento dinámico: Icl,d = Icl·(0.6 + 0.4/M) si M > 1.2 met.
  const dynamicClo = (clo, met) => (met > 1.2 ? clo * (0.6 + 0.4 / met) : clo);

  // Búsqueda de raíces de CBE (util.js): secante con tolerancia absoluta sobre f, y bisección de respaldo.
  function secant(a, b, fn, eps) {
    let f1 = fn(a);
    if (Math.abs(f1) <= eps) return a;
    let f2 = fn(b);
    if (Math.abs(f2) <= eps) return b;
    for (let i = 0; i < 100; i++) {
      const slope = (f2 - f1) / (b - a);
      if (slope === 0) return NaN;
      let c = b - f2 / slope;
      if (c < 0) c = 0;
      if (c > 100) c = 100;
      const f3 = fn(c);
      if (Math.abs(f3) < eps) return c;
      a = b; b = c; f1 = f2; f2 = f3;
    }
    return NaN;
  }
  function bisect(a, b, fn, eps, target) {
    let mid;
    while (Math.abs(b - a) > 2 * eps) {
      mid = (b + a) / 2;
      const aT = fn(a), bT = fn(b), mT = fn(mid);
      if ((aT - target) * (mT - target) < 0) b = mid;
      else if ((bT - target) * (mT - target) < 0) a = mid;
      else return -999;
    }
    return mid;
  }

  /* SET (Gagge, dos nodos) — comf.pierceSET de CBE. vel y clo son los que reciba el modelo (sin correcciones internas).
     calcCE = true desactiva el h_c por actividad (se usa solo en el cálculo del efecto de enfriamiento). */
  function set(ta, tr, vel, rh, met, clo, wme = 0, calcCE = false, maxSkinBloodFlow = 90, position = 'sitting') {
    const vp = rh * satTorr(ta) / 100, airSpeed = Math.max(vel, 0.1);
    const kClo = 0.25, bw = 69.9, bsa = 1.8258, mFactor = 58.2, sbc = 0.000000056697;
    const cSw = 170, cDil = 120, cStr = 0.5;
    const tsN = 33.7, tcN = 36.8, tbN = 36.49, sbfN = 6.3;

    let tsk = tsN, tcr = tcN, sbf = sbfN, alfa = 0.1, esk = 0.1 * met;
    const pAtm = (P_ATM / 1000) * 0.009869;
    const rCl = 0.155 * clo, facl = 1 + 0.15 * clo, lr = 2.2 / pAtm;
    const rm = met * mFactor;
    let m = met * mFactor;

    let wcrit, icl;
    if (clo <= 0) { wcrit = 0.38 * Math.pow(airSpeed, -0.29); icl = 1.0; }
    else { wcrit = 0.59 * Math.pow(airSpeed, -0.08); icl = 0.45; }

    const hcMet = met < 0.85 ? 3.0 : 5.66 * Math.pow(met - 0.85, 0.39);
    let chc = 3.0 * Math.pow(pAtm, 0.53);
    chc = Math.max(chc, 8.600001 * Math.pow(airSpeed * pAtm, 0.53));
    if (!calcCE) chc = Math.max(chc, hcMet);

    let chr = 4.7, ctc = chr + chc, ra = 1 / (facl * ctc), top = (chr * tr + chc * ta) / ctc;
    let tcl = top + (tsk - top) / (ctc * (ra + rCl)), tclOld = tcl, flag = true;
    let dry = 0, pwet = 0, ersw = 0, edif = 0;
    const radArea = position === 'sitting' ? 0.7 : 0.73;

    for (let tim = 1; tim <= 60; tim++) {
      let guard = 0;
      do {
        if (flag) {
          tclOld = tcl;
          chr = 4.0 * 0.95 * sbc * Math.pow((tcl + tr) / 2 + 273.15, 3) * radArea;
          ctc = chr + chc; ra = 1 / (facl * ctc); top = (chr * tr + chc * ta) / ctc;
        }
        tcl = (ra * tsk + rCl * top) / (ra + rCl);
        flag = true;
      } while (Math.abs(tcl - tclOld) > 0.01 && ++guard < 1000);
      flag = false;
      dry = (tsk - top) / (ra + rCl);
      const hfcs = (tcr - tsk) * (5.28 + 1.163 * sbf);
      const eres = 0.0023 * m * (44 - vp), cres = 0.0014 * m * (34 - ta);
      const scr = m - hfcs - eres - cres - wme, ssk = hfcs - dry - esk;
      const tcsk = 0.97 * alfa * bw, tccr = 0.97 * (1 - alfa) * bw;
      tsk += ssk * bsa / (tcsk * 60); tcr += scr * bsa / (tccr * 60);
      const tb = alfa * tsk + (1 - alfa) * tcr;
      const sksig = tsk - tsN, warms = Math.max(sksig, 0), colds = Math.max(-sksig, 0);
      const crsig = tcr - tcN, warmc = Math.max(crsig, 0), coldc = Math.max(-crsig, 0);
      const warmb = Math.max(tb - tbN, 0);
      sbf = (sbfN + cDil * warmc) / (1 + cStr * colds);
      if (sbf > maxSkinBloodFlow) sbf = maxSkinBloodFlow;
      if (sbf < 0.5) sbf = 0.5;
      let regsw = cSw * warmb * Math.exp(warms / 10.7);
      if (regsw > 500) regsw = 500;
      ersw = 0.68 * regsw;
      const rea = 1 / (lr * facl * chc), recl = rCl / (lr * icl);
      const emax = (satTorr(tsk) - vp) / (rea + recl);
      let prsw = ersw / emax;
      pwet = 0.06 + 0.94 * prsw;
      edif = pwet * emax - ersw;
      if (pwet > wcrit) { pwet = wcrit; prsw = wcrit / 0.94; ersw = prsw * emax; edif = 0.06 * (1 - prsw) * emax; }
      if (emax < 0) { edif = 0; ersw = 0; pwet = wcrit; prsw = wcrit; }
      esk = ersw + edif;
      m = rm + 19.4 * colds * coldc;
      alfa = 0.0417737 + 0.7451833 / (sbf + 0.585417);
    }

    // Ambiente estándar de ASHRAE 55 (50 % HR, aire quieto, Ta = MRT, ropa estándar para la actividad)
    const hsk = dry + esk, pssk = satTorr(tsk);
    let chcS = 3.0 * Math.pow(pAtm, 0.53);
    if (!calcCE && met > 0.85) chcS = Math.max(chcS, hcMet);
    if (chcS < 3.0) chcS = 3.0;
    const ctcS = chcS + chr;
    const rclos = 1.52 / (met - wme / mFactor + 0.6944) - 0.1835, rcls = 0.155 * rclos;
    const facls = 1 + kClo * rclos, fcls = 1 / (1 + 0.155 * facls * ctcS * rclos), ims = 0.45;
    const icls = ims * chcS / ctcS * (1 - fcls) / (chcS / ctcS - fcls * ims);
    const hdS = 1 / (1 / (facls * ctcS) + rcls);
    const heS = 1 / (1 / (lr * facls * chcS) + rcls / (lr * icls));
    const delta = 0.0001;
    let dx = 100, xOld = tsk - hsk / hdS, x = xOld;
    for (let n = 0; Math.abs(dx) > 0.01 && n < 1000; n++) {
      const e1 = hsk - hdS * (tsk - xOld) - pwet * heS * (pssk - 0.5 * satTorr(xOld));
      const e2 = hsk - hdS * (tsk - (xOld + delta)) - pwet * heS * (pssk - 0.5 * satTorr(xOld + delta));
      x = xOld - delta * e1 / (e2 - e1); dx = x - xOld; xOld = x;
    }
    return x;
  }

  // Efecto de enfriamiento (comf.cooling_effect): ΔT restado a Ta y MRT que da, en aire quieto, el mismo SET.
  // vr y clo deben ser los ya corregidos por actividad.
  function coolingEffect(ta, tr, vr, rh, met, clo, wme = 0) {
    if (vr <= STILL_AIR) return 0;
    const eps = 0.001;
    const target = set(ta, tr, vr, rh, met, clo, wme, true, 90, 'standing');
    const fn = c => target - set(ta - c, tr - c, STILL_AIR, rh, met, clo, wme, true, 90, 'standing');
    let ce = secant(0, 40, fn, eps);
    if (isNaN(ce)) ce = bisect(0, 40, fn, eps, 0);
    return ce < 0 ? 0 : ce;
  }

  /* Evaluación completa de un punto (comf.pmvElevatedAirspeed de CBE).
     vel = velocidad del aire medida; clo = aislamiento original. Las correcciones por actividad se aplican aquí, una sola vez:
       · PMV/PPD usan la velocidad relativa y el aislamiento dinámico (y, si hay efecto de enfriamiento, Ta−CE, MRT−CE, v = 0.1).
       · SET usa la velocidad medida y el aislamiento original, igual que CBE.
     opts.selfAirSpeed = false desactiva la velocidad generada por la actividad; opts.skipSet omite el SET (más rápido). */
  function evaluate(ta, tr, vel, rh, met, clo, opts) {
    const self = !opts || opts.selfAirSpeed !== false, wme = 0;
    const vr = relativeSpeed(vel, met, self), cloD = dynamicClo(clo, met);
    let ce = coolingEffect(ta, tr, vr, rh, met, cloD, wme), pmv;
    if (vr <= STILL_AIR || ce === 0) { pmv = fanger(ta, tr, vr, rh, met, cloD); ce = 0; }
    else pmv = fanger(ta - ce, tr - ce, STILL_AIR, rh, met, cloD);
    return { pmv, ppd: ppdFromPmv(pmv), set: opts && opts.skipSet ? NaN : set(ta, tr, vel, rh, met, clo, wme), ce, vr, cloD, taAdj: ta - ce, trAdj: tr - ce };
  }

  function sensation(pmv) {
    const k = Math.max(-3, Math.min(3, Math.round(pmv)));
    return ['Frío', 'Fresco', 'Ligeramente fresco', 'Neutro', 'Ligeramente caluroso', 'Caluroso', 'Muy caluroso'][k + 3];
  }

  G.Comfort = { evaluate, set, coolingEffect, relativeSpeed, dynamicClo, secant, bisect, sensation, LIMIT: 0.5 };
})(window);
