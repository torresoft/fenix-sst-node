// Verificador del expediente sin conexion: recalcula el SHA-256 de los archivos seleccionados en el
// navegador del inspector y los compara con el manifiesto empaquetado (manifiesto.js).
(function () {
  'use strict';

  var entrada = document.getElementById('archivos');
  var cuerpo = document.getElementById('resultado');
  var resumen = document.getElementById('resumen');
  var porNombre = {};
  (window.MANIFIESTO.documentos || []).forEach(function (d) {
    if (d.ruta) porNombre[d.ruta.split('/').pop()] = d;
  });

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function fila(celdas, clase) {
    var tr = document.createElement('tr');
    if (clase) tr.className = clase;
    celdas.forEach(function (c) { var td = document.createElement('td'); td.textContent = c; tr.appendChild(td); });
    cuerpo.appendChild(tr);
  }

  entrada.addEventListener('change', function () {
    cuerpo.innerHTML = '';
    var archivos = Array.prototype.slice.call(entrada.files);
    var ok = 0;
    var mal = 0;
    Promise.all(archivos.map(function (f) {
      return f.arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(function (h) {
        var calculado = hex(h);
        var d = porNombre[f.name];
        if (!d) { fila([f.name, 'No esta en el manifiesto', calculado], 'aviso'); return; }
        var bien = calculado === d.sha256_registrado && d.firmas.every(function (x) { return x.sha256_firmado === calculado; });
        if (bien) ok += 1; else mal += 1;
        fila([f.name, bien ? 'Integro: coincide con el registro y con sus firmas' : 'ALTERADO: la huella no coincide', calculado], bien ? 'ok' : 'error');
      });
    })).then(function () {
      resumen.textContent = ok + ' archivo(s) integro(s), ' + mal + ' con problemas.';
    });
  });
}());
