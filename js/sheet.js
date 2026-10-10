/* Lectura de archivos Excel (.xlsx/.xls) usando SheetJS: se convierten a texto CSV (separador ;) para reutilizar CSV.parse. */
(function (G) {
  'use strict';

  const p2 = n => String(n).padStart(2, '0');

  function cellText(X, c) {
    if (!c || c.v === undefined || c.v === null) return '';
    if (c.t === 'n') {
      if (c.z && X.SSF.is_date(c.z)) {
        const d = X.SSF.parse_date_code(c.v);
        if (!d) return String(c.v);
        const time = p2(d.H) + ':' + p2(d.M) + ':' + p2(d.S);
        if (c.v < 1) return time;                       // solo hora (fracción de día)
        const date = p2(d.d) + '/' + p2(d.m) + '/' + d.y;
        return d.H || d.M || d.S ? date + ' ' + time : date;
      }
      return String(c.v);
    }
    if (c.t === 'e') return '';
    return String(c.v);
  }

  const quote = s => /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;

  // ArrayBuffer de un libro de Excel -> texto CSV de la primera hoja.
  function toText(buf) {
    const X = G.XLSX;
    if (!X) throw new Error('No se pudo cargar el lector de Excel (sin conexión). Guardá el archivo como CSV e intentá de nuevo.');
    let wb;
    try { wb = X.read(buf, { type: 'array', cellNF: true }); }
    catch (e) { throw new Error('No se pudo leer el archivo de Excel: ' + (e.message || e)); }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws || !ws['!ref']) throw new Error('La hoja de Excel está vacía.');
    const rg = X.utils.decode_range(ws['!ref']);
    let rows = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const row = [];
      for (let c = rg.s.c; c <= rg.e.c; c++) row.push(cellText(X, ws[X.utils.encode_cell({ r, c })]).trim());
      if (row.some(s => s !== '')) rows.push(row);
    }
    const width = Math.max(0, ...rows.map(r => r.reduce((w, s, j) => s !== '' ? j + 1 : w, 0)));
    rows = rows.map(r => r.slice(0, width));
    return rows.map(r => r.map(quote).join(';')).join('\n');
  }

  G.Sheet = { toText };
})(window);
