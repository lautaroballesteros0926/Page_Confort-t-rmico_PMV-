/* Modelo de confort térmico: PMV de Fanger + SET de Gagge (dos nodos) con el método de ASHRAE 55-2023. */
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

  /* ---------- correcciones por actividad (ASHRAE 55-2023) ---------- */
  // Velocidad relativa: Vr = Va + 0.3·(M − 1) si M > 1 met; si no, Vr = Va.
  const relativeSpeed = (va, met) => (met > 1 ? va + 0.3 * (met - 1) : va);
  // Aislamiento dinámico: Icl,d = Icl·(0.6 + 0.4/M) si M > 1.2 met; si no, Icl.
  const dynamicClo = (clo, met) => (met > 1.2 ? clo * (0.6 + 0.4 / met) : clo);

  /* ---------- SET: modelo de dos nodos de Gagge (ASHRAE 55 App. D / Gagge 1986) ----------
     Recibe velocidad y aislamiento ya corregidos por actividad (vr, Icl,d); no los vuelve a corregir.
     calcCE = true desactiva el h_c por actividad (así se usa en el cálculo del efecto de enfriamiento). */
  function set(ta, tr, vr, rh, met, clo, calcCE) {
    const wme = 0, bsa = 1.8258, kClo = 0.25, bw = 70, mFactor = 58.2, sbc = 5.6697e-8;
    const cSw = 170, cDil = 120, cStr = 0.5;
    const tsN = 33.7, tcN = 36.8, sbfN = 6.3;
    let alfa = 0.1;
    const tbN = alfa * tsN + (1 - alfa) * tcN;
    let tsk = tsN, tcr = tcN, mbl = sbfN, esk = 0.1 * met;
    const vp = rh * satTorr(ta) / 100, av = Math.max(vr, 0.1);
    const lr = 2.2, rClo = 0.155 * clo, faCl = 1 + 0.15 * clo;
    const rm = (met - wme) * mFactor;
    let m = met * mFactor;
    const iCl = clo > 0 ? 0.45 : 1;
    const wMax = clo > 0 ? 0.59 * Math.pow(av, -0.08) : 0.38 * Math.pow(av, -0.29);

    let hcc = Math.max(3.0, 8.600001 * Math.pow(av, 0.53));
    if (!calcCE && met > 0.85) hcc = Math.max(hcc, 5.66 * Math.pow(met - 0.85, 0.39));

    let hr = 4.7, ht = hr + hcc, ra = 1 / (faCl * ht), top = (hr * tr + hcc * ta) / ht;
    const qRes = 0.0023 * m * (44 - vp), cRes = 0.0014 * m * (34 - ta);
    let qSens = 0, w = 0, tcl;

    for (let sim = 1; sim < 60; sim++) {
      tcl = (ra * tsk + rClo * top) / (ra + rClo);
      for (let k = 0; k < 150; k++) {
        hr = 4 * 0.95 * sbc * Math.pow((tcl + tr) / 2 + 273.15, 3) * 0.73;
        ht = hr + hcc; ra = 1 / (faCl * ht); top = (hr * tr + hcc * ta) / ht;
        const next = (ra * tsk + rClo * top) / (ra + rClo), done = Math.abs(next - tcl) <= 0.01;
        tcl = next;
        if (done) break;
      }
      qSens = (tsk - top) / (ra + rClo);
      const hfcs = (tcr - tsk) * (5.28 + 1.163 * mbl);
      const sCore = m - hfcs - qRes - cRes - wme, sSkin = hfcs - qSens - esk;
      const tcSk = 0.97 * alfa * bw, tcCr = 0.97 * (1 - alfa) * bw;
      tsk += sSkin * bsa / (tcSk * 60); tcr += sCore * bsa / (tcCr * 60);
      const tb = alfa * tsk + (1 - alfa) * tcr;
      const skSig = tsk - tsN, warmSk = Math.max(skSig, 0), coldSk = Math.max(-skSig, 0);
      const crSig = tcr - tcN, warmC = Math.max(crSig, 0), coldC = Math.max(-crSig, 0);
      const warmB = Math.max(tb - tbN, 0);
      mbl = Math.max(0.5, Math.min(90, (sbfN + cDil * warmC) / (1 + cStr * coldSk)));
      const ersw0 = 0.68 * Math.min(500, cSw * warmB * Math.exp(warmSk / 10.7));
      const rea = 1 / (lr * faCl * hcc), recl = rClo / (lr * iCl);
      let emax = (satTorr(tsk) - vp) / (rea + recl);
      if (emax === 0) emax = 0.001;
      let ersw = ersw0, prsw = ersw / emax;
      w = 0.06 + 0.94 * prsw;
      let ediff = w * emax - ersw;
      if (w > wMax) { w = wMax; prsw = wMax / 0.94; ersw = prsw * emax; ediff = 0.06 * (1 - prsw) * emax; }
      if (emax < 0) { ediff = 0; ersw = 0; w = wMax; }
      esk = ersw + ediff;
      m = rm + 19.4 * coldSk * coldC;
      alfa = 0.0417737 + 0.7451833 / (mbl + 0.585417);
    }

    // Ambiente estándar (50 % HR, aire quieto, Ta = MRT) con ropa estándar para la actividad
    const qSkin = qSens + esk, pSsk = satTorr(tsk);
    let hcS = 3.0;
    if (!calcCE && met > 0.85) hcS = Math.max(hcS, 5.66 * Math.pow(met - 0.85, 0.39));
    const htS = hcS + hr;
    const cloS = 1.52 / ((met - wme / mFactor) + 0.6944) - 0.1835, rClS = 0.155 * cloS;
    const faS = 1 + kClo * cloS, fClS = 1 / (1 + 0.155 * faS * htS * cloS), imS = 0.45;
    const iClS = imS * hcS / htS * (1 - fClS) / (hcS / htS - fClS * imS);
    const hdS = 1 / (1 / (faS * htS) + rClS), heS = 1 / (1 / (lr * faS * hcS) + rClS / (lr * iClS));
    let xo = tsk - qSkin / hdS, x = xo, dx = 100;
    for (let n = 0; Math.abs(dx) > 0.01 && n < 100; n++) {
      const d = 0.0001;
      const e1 = qSkin - hdS * (tsk - xo) - w * heS * (pSsk - 0.5 * satTorr(xo));
      const e2 = qSkin - hdS * (tsk - (xo + d)) - w * heS * (pSsk - 0.5 * satTorr(xo + d));
      x = xo - d * e1 / (e2 - e1); dx = x - xo; xo = x;
    }
    return x;
  }

  // Método de Brent (mismo algoritmo que scipy.optimize.brentq, que usa CBE). NaN si no hay cambio de signo.
  function brent(f, xa, xb) {
    const xtol = 2e-12, rtol = 8.881784197001252e-16;
    let xpre = xa, xcur = xb, xblk = 0, fpre = f(xpre), fcur = f(xcur), fblk = 0, spre = 0, scur = 0;
    if (fpre * fcur > 0) return NaN;
    if (fpre === 0) return xpre;
    if (fcur === 0) return xcur;
    for (let i = 0; i < 100; i++) {
      if (fpre * fcur < 0) { xblk = xpre; fblk = fpre; spre = scur = xcur - xpre; }
      if (Math.abs(fblk) < Math.abs(fcur)) { xpre = xcur; xcur = xblk; xblk = xpre; fpre = fcur; fcur = fblk; fblk = fpre; }
      const delta = (xtol + rtol * Math.abs(xcur)) / 2, sbis = (xblk - xcur) / 2;
      if (fcur === 0 || Math.abs(sbis) < delta) return xcur;
      if (Math.abs(spre) > delta && Math.abs(fcur) < Math.abs(fpre)) {
        let stry;
        if (xpre === xblk) stry = -fcur * (xcur - xpre) / (fcur - fpre);
        else {
          const dpre = (fpre - fcur) / (xpre - xcur), dblk = (fblk - fcur) / (xblk - xcur);
          stry = -fcur * (fblk * dblk - fpre * dpre) / (dblk * dpre * (fblk - fpre));
        }
        if (2 * Math.abs(stry) < Math.min(Math.abs(spre), 3 * Math.abs(sbis) - delta)) { spre = scur; scur = stry; }
        else spre = scur = sbis;
      } else spre = scur = sbis;
      xpre = xcur; fpre = fcur;
      xcur += Math.abs(scur) > delta ? scur : (sbis > 0 ? delta : -delta);
      fcur = f(xcur);
    }
    return xcur;
  }

  // Efecto de enfriamiento (ASHRAE 55 App. H): ΔT que, restado a Ta y MRT en aire quieto (0.1 m/s), da el mismo SET.
  function coolingEffect(ta, tr, vr, rh, met, clo) {
    if (vr <= 0.1) return 0;
    const target = set(ta, tr, vr, rh, met, clo, true);
    const f = c => set(ta - c, tr - c, 0.1, rh, met, clo, true) - target;
    const ce = brent(f, 0, 40);
    return isFinite(ce) ? ce : 0;
  }

  // PMV / PPD según ASHRAE 55-2023. Si vr > 0.1 m/s se resta el efecto de enfriamiento a Ta y MRT y se usa vr = 0.1.
  // vr y clo deben venir ya corregidos por actividad (relativeSpeed / dynamicClo).
  function pmvppd(ta, tr, vr, rh, met, clo) {
    let ce = coolingEffect(ta, tr, vr, rh, met, clo);
    if (ce < 0.005) ce = 0; // CE inapreciable (CBE lo redondea a 0.01): el aire no enfría y PMV usa vr tal cual
    const pmv = fanger(ta - ce, tr - ce, ce > 0 ? 0.1 : vr, rh, met, clo);
    return { pmv, ppd: ppdFromPmv(pmv), ce };
  }

  function sensation(pmv) {
    const k = Math.max(-3, Math.min(3, Math.round(pmv)));
    return ['Frío', 'Fresco', 'Ligeramente fresco', 'Neutro', 'Ligeramente caluroso', 'Caluroso', 'Muy caluroso'][k + 3];
  }

  G.Comfort = { pmvppd, set, coolingEffect, relativeSpeed, dynamicClo, sensation, LIMIT: 0.5 };
})(window);
