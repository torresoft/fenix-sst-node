// Comportamiento comun: tooltips, CSRF en AJAX, confirmacion de formularios, autoenvio de filtros y barras de progreso.
(function ($) {
  'use strict';

  var token = $('meta[name="csrf-token"]').attr('content');

  $.ajaxSetup({
    headers: { 'X-CSRF-Token': token },
    dataType: 'json'
  });

  $(document).ajaxError(function (evento, xhr) {
    if (xhr.status === 401) window.location.href = '/login';
  });

  $(document).on('submit', 'form.js-confirmar', function (e) {
    if (!window.confirm($(this).data('confirmar') || '\u00bfConfirma la acci\u00f3n?')) e.preventDefault();
  });

  $(document).on('change', '.js-autoenvio', function () { $(this).closest('form').trigger('submit'); });

  $(function () {
    $('[data-toggle="tooltip"]').tooltip();
    // Pestanas del lado del cliente: recuerda la ultima abierta de cada pagina (tras un POST se vuelve a ella).
    var clave = 'pestana:' + location.pathname;
    $('a[data-toggle="tab"]').on('shown.bs.tab', function () {
      try { sessionStorage.setItem(clave, $(this).attr('href')); } catch (e) { /* sin almacenamiento */ }
    });
    var guardada = null;
    try { guardada = sessionStorage.getItem(clave); } catch (e) { /* sin almacenamiento */ }
    var porHash = location.hash && /^#[\w-]+$/.test(location.hash) ? $('a[data-toggle="tab"][href="#tab-' + location.hash.slice(1) + '"]') : $();
    if (porHash.length) porHash.tab('show');
    else if (guardada) $('a[data-toggle="tab"][href="' + guardada.replace(/"/g, '') + '"]').tab('show');
    // Barras de progreso: ancho via CSSOM (la CSP no permite style en linea).
    $('.js-barra').each(function () {
      var v = Math.max(0, Math.min(100, Number($(this).data('valor')) || 0));
      $(this).css('width', v + '%').attr('aria-valuenow', v);
    });
  });
}(jQuery));
