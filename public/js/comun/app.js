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

  // Cargando: capa al navegar o enviar (con retardo para no parpadear) y barra superior durante AJAX.
  // Las descargas (a[download], form[data-descarga]) no cambian de pagina: no la muestran.
  var capa = $('<div class="cargando" role="status" hidden><div class="cargando-caja"><i class="fas fa-circle-notch fa-spin"></i><span>Cargando...</span></div></div>');
  var barra = $('<div class="cargando-barra" hidden></div>');
  var retardo = null;
  var ajaxActivos = 0;

  function mostrarCargando() {
    if (!retardo) retardo = setTimeout(function () { capa.prop('hidden', false); }, 250);
  }

  function ocultarCargando() {
    clearTimeout(retardo);
    retardo = null;
    capa.prop('hidden', true);
    $('.js-cargando-off').prop('disabled', false).removeClass('js-cargando-off');
  }

  $(document).on('click', 'a[href]', function (e) {
    var a = this;
    var href = a.getAttribute('href');
    if (e.isDefaultPrevented() || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return;
    if (a.hasAttribute('download') || (a.target && a.target !== '_self') || a.origin !== location.origin) return;
    if ($(a).is('[data-toggle],[data-widget],[data-dismiss]')) return;
    if (a.pathname === location.pathname && a.search === location.search && a.hash) return;
    mostrarCargando();
  });

  // Va despues de js-confirmar: si el usuario cancela, no se muestra.
  $(document).on('submit', 'form', function (e) {
    var form = $(this);
    if (e.isDefaultPrevented() || form.is('[data-descarga]') || (this.target && this.target !== '_self')) return;
    mostrarCargando();
    // Tras armar el envio: un boton deshabilitado antes no manda su name/value.
    setTimeout(function () { form.find('[type="submit"]:enabled').prop('disabled', true).addClass('js-cargando-off'); }, 0);
  });

  // Volver con el boton atras (bfcache) restaura la pagina con la capa puesta.
  window.addEventListener('pageshow', ocultarCargando);

  $(document).ajaxSend(function () { ajaxActivos += 1; barra.prop('hidden', false); });
  $(document).ajaxComplete(function () {
    ajaxActivos = Math.max(0, ajaxActivos - 1);
    if (!ajaxActivos) barra.prop('hidden', true);
  });

  $(function () {
    $('body').append(capa, barra);
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
