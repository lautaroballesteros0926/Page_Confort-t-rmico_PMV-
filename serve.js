// Servidor estático mínimo (opcional): node serve.js  →  http://localhost:5173
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
http.createServer((req, res) => {
  const p = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(5173, () => console.log('http://localhost:5173'));
