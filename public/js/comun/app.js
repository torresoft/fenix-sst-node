// Comportamiento comun: navegacion con Turbo, cargando, tooltips, CSRF en AJAX, confirmacion de formularios,
// autoenvio de filtros, pestanas y barras de progreso. Se carga una vez en el head; lo de cada pagina va en iniciar().
(function ($) {
  'use strict';

  // La barra de Turbo inserta estilos en linea (CSP): se usa la capa propia.
  if (window.Turbo) Turbo.config.drive.progressBarDelay = 1e9;

  // El token cambia al iniciar sesion (sesion regenerada) y Turbo reemplaza la meta: se lee en cada envio.
  $.ajaxSetup({
    dataType: 'json',
    beforeSend: function (xhr) { xhr.setRequestHeader('X-CSRF-Token', $('meta[name="csrf-token"]').attr('content')); }
  });

  $(document).ajaxError(function (evento, xhr) {
    if (xhr.status === 401) window.location.href = '/login';
  });

  $(document).on('submit', 'form.js-confirmar', function (e) {
    if (!window.confirm($(this).data('confirmar') || '¿Confirma la acción?')) e.preventDefault();
  });

  // requestSubmit dispara el evento submit (Turbo lo intercepta); form.submit() recargaria toda la pagina.
  $(document).on('change', '.js-autoenvio', function () {
    var form = $(this).closest('form')[0];
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });

  // Cargando: capa al navegar o enviar (con retardo para no parpadear) y barra superior durante AJAX.
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
  }

  $(document).on('turbo:visit turbo:submit-start', mostrarCargando);
  $(document).on('turbo:fetch-request-error', ocultarCargando);
  $(document).on('turbo:submit-end', function (e) {
    if (!e.originalEvent.detail.success) ocultarCargando();
  });

  $(document).ajaxSend(function () { ajaxActivos += 1; barra.prop('hidden', false); });
  $(document).ajaxComplete(function () {
    ajaxActivos = Math.max(0, ajaxActivos - 1);
    if (!ajaxActivos) barra.prop('hidden', true);
  });

  // El body nuevo llega del server sin el estado del menu lateral: se conserva el colapso.
  document.addEventListener('turbo:before-render', function (e) {
    e.detail.newBody.classList.toggle('sidebar-collapse', document.body.classList.contains('sidebar-collapse'));
  });

  // AdminLTE inicia el menu en el load de la ventana; si se entro por /login (sin menu), nunca lo hizo.
  // Su listener es delegado en document: basta iniciarlo una vez.
  var menuListo = false;
  $(window).on('load', function () { if ($('[data-widget="treeview"]').length) menuListo = true; });

  // Cada pagina (carga inicial o body nuevo de Turbo). Idempotente: puede llegar por varios eventos.
  function iniciar(e) {
    ocultarCargando();
    var body = $('body');
    if (body.data('iniciado')) return;
    body.data('iniciado', true).append(capa, barra.prop('hidden', !ajaxActivos));
    setTimeout(function () { body.removeClass('hold-transition'); }, 50);
    if (body.find('.content-wrapper').length && $.fn.Layout) body.Layout('fixLayoutHeight');
    if (e && e.type === 'turbo:render' && !menuListo && $('[data-widget="treeview"]').length) {
      $('[data-widget="treeview"]').Treeview('init');
      menuListo = true;
    }

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
  }

  // Tooltips abiertos quedan colgando del body viejo.
  document.addEventListener('turbo:before-render', function () { $('.tooltip').remove(); });
  $(iniciar);
  $(document).on('turbo:load turbo:render', iniciar);
}(jQuery));
