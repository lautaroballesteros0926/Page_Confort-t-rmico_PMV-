/* Modelo de confort térmico: Fanger (ISO 7730) + corrección SET por velocidad del aire (ASHRAE 55). */
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

  // Temperatura efectiva estándar (modelo de dos nodos de Pierce)
  function pierceSet(ta, tr, vel, rh, met, clo) {
    const wme = 0, vp = rh * satTorr(ta) / 100, av = Math.max(vel, 0.1);
    const bw = 69.9, bsa = 1.8258, mf = 58.2, sbc = 5.6697e-8, csw = 170, cdil = 120, cstr = 0.5;
    const tsN = 33.7, tcN = 36.8, tbN = 36.49, sbfN = 6.3;
    let tsk = tsN, tcr = tcN, sbf = sbfN, alfa = 0.1, esk = 0.1 * met;
    const rcl = 0.155 * clo, facl = 1 + 0.15 * clo, pAtm = 101.325 * 0.009869, LR = 2.2 / pAtm;
    const RM = met * mf; let M = RM, wcrit, icl;
    if (clo <= 0) { wcrit = 0.38 * Math.pow(av, -0.29); icl = 1; } else { wcrit = 0.59 * Math.pow(av, -0.08); icl = 0.45; }
    const chc = Math.max(3.0 * Math.pow(pAtm, 0.53), 8.600001 * Math.pow(av * pAtm, 0.53));
    let chr = 4.7, ctc = chr + chc, ra = 1 / (facl * ctc), top = (chr * tr + chc * ta) / ctc;
    let tcl = top + (tsk - top) / (ctc * (ra + rcl));
    let tclOld = 0, flag = true, dry = 0, pwet = 0, emax = 0, ersw = 0, edif = 0;
    for (let i = 0; i < 59; i++) {
      while (Math.abs(tcl - tclOld) > 0.01) {
        if (flag) {
          tclOld = tcl;
          chr = 4 * sbc * Math.pow((tcl + tr) / 2 + 273.15, 3) * 0.72;
          ctc = chr + chc; ra = 1 / (facl * ctc); top = (chr * tr + chc * ta) / ctc;
        }
        tcl = (ra * tsk + rcl * top) / (ra + rcl);
        flag = true;
      }
      flag = false;
      dry = (tsk - top) / (ra + rcl);
      const hfcs = (tcr - tsk) * (5.28 + 1.163 * sbf);
      const eres = 0.0023 * M * (44 - vp), cres = 0.0014 * M * (34 - ta);
      const scr = M - hfcs - eres - cres - wme, ssk = hfcs - dry - esk;
      const tcsk = 0.97 * alfa * bw, tccr = 0.97 * (1 - alfa) * bw;
      tsk += ssk * bsa / (tcsk * 60); tcr += scr * bsa / (tccr * 60);
      const TB = alfa * tsk + (1 - alfa) * tcr;
      const sksig = tsk - tsN, warms = sksig > 0 ? sksig : 0, colds = -sksig > 0 ? -sksig : 0;
      const crsig = tcr - tcN, warmc = crsig > 0 ? crsig : 0, coldc = -crsig > 0 ? -crsig : 0;
      const warmb = TB - tbN > 0 ? TB - tbN : 0;
      sbf = Math.min(90, Math.max(0.5, (sbfN + cdil * warmc) / (1 + cstr * colds)));
      ersw = 0.68 * Math.min(500, csw * warmb * Math.exp(warms / 10.7));
      const rea = 1 / (LR * facl * chc), recl = rcl / (LR * icl);
      emax = (satTorr(tsk) - vp) / (rea + recl);
      let prsw = ersw / emax;
      pwet = 0.06 + 0.94 * prsw; edif = pwet * emax - ersw; esk = ersw + edif;
      if (pwet > wcrit) { pwet = wcrit; prsw = wcrit / 0.94; ersw = prsw * emax; edif = 0.06 * (1 - prsw) * emax; esk = ersw + edif; }
      if (emax < 0) { edif = 0; ersw = 0; pwet = wcrit; prsw = wcrit; esk = emax; }
      esk = ersw + edif;
      M = RM + 19.4 * colds * coldc;
      alfa = 0.0417737 + 0.7451833 / (sbf + 0.585417);
    }
    const hsk = dry + esk, pssk = satTorr(tsk);
    const chcS = met < 0.85 ? 3.0 : Math.max(3.0, 5.66 * Math.pow(met - 0.85, 0.39));
    const ctcs = chcS + chr;
    const rclos = 1.52 / (met + 0.6944) - 0.1835, rcls = 0.155 * rclos;
    const facls = 1 + 0.25 * rclos, fcls = 1 / (1 + 0.155 * facls * ctcs * rclos), ims = 0.45;
    const icls = ims * chcS / ctcs * (1 - fcls) / (chcS / ctcs - fcls * ims);
    const hdS = 1 / (1 / (facls * ctcs) + rcls), heS = 1 / (1 / (LR * facls * chcS) + rcls / (LR * icls));
    const delta = 0.0001; let dx = 100, xo = tsk - hsk / hdS, x = xo, n = 0;
    while (Math.abs(dx) > 0.01 && n++ < 100) {
      const e1 = hsk - hdS * (tsk - xo) - pwet * heS * (pssk - 0.5 * satTorr(xo));
      const e2 = hsk - hdS * (tsk - (xo + delta)) - pwet * heS * (pssk - 0.5 * satTorr(xo + delta));
      x = xo - delta * e1 / (e2 - e1); dx = x - xo; xo = x;
    }
    return x;
  }

  // PMV / PPD. Si v > 0.1 m/s se corrige con el efecto de enfriamiento (SET).
  function pmvppd(ta, tr, v, rh, met, clo) {
    let pmv, ce = 0;
    if (v <= 0.1) pmv = fanger(ta, tr, v, rh, met, clo);
    else {
      const se = pierceSet(ta, tr, v, rh, met, clo);
      let a = 0, b = 40;
      for (let i = 0; i < 16; i++) {
        const c = (a + b) / 2;
        if (se - pierceSet(ta - c, tr - c, 0.1, rh, met, clo) < 0) a = c; else b = c;
      }
      ce = (a + b) / 2;
      pmv = fanger(ta - ce, tr - ce, 0.1, rh, met, clo);
    }
    return { pmv, ppd: ppdFromPmv(pmv), ce };
  }

  function sensation(pmv) {
    const k = Math.max(-3, Math.min(3, Math.round(pmv)));
    return ['Frío', 'Fresco', 'Ligeramente fresco', 'Neutro', 'Ligeramente caluroso', 'Caluroso', 'Muy caluroso'][k + 3];
  }

  G.Comfort = { pmvppd, pierceSet, sensation, LIMIT: 0.5 };
})(window);
