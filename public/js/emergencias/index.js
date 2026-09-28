// Emergencias: modales de revision, baja, historial de equipos y anulacion de simulacros.
(function ($) {
  'use strict';

  function abrir(modal, form, accion, codigo) {
    $(form).attr('action', accion).trigger('reset');
    $(modal).find('.js-codigo').text(codigo || '');
    $(modal).modal('show');
  }

  $('.js-revision').on('click', function () {
    var b = $(this);
    abrir('#modal-revision', '#form-revision', '/emergencias/equipos/' + encodeURIComponent(b.data('id')) + '/revision', b.data('codigo'));
  });

  $('.js-baja').on('click', function () {
    var b = $(this);
    abrir('#modal-baja', '#form-baja', '/emergencias/equipos/' + encodeURIComponent(b.data('id')) + '/baja', b.data('codigo'));
  });

  $('.js-anular-simulacro').on('click', function () {
    abrir('#modal-anular-simulacro', '#form-anular-simulacro', '/emergencias/simulacros/' + encodeURIComponent($(this).data('id')) + '/anular');
  });

  $('.js-historial').on('click', function () {
    var b = $(this);
    var cuerpo = $('#modal-historial .js-filas').empty();
    $('#modal-historial .js-codigo').text(b.data('codigo'));
    $.get('/emergencias/equipos/' + encodeURIComponent(b.data('id')) + '/revisiones').done(function (r) {
      if (!r.revisiones.length) cuerpo.append($('<tr>').append($('<td colspan="5" class="text-muted">').text('Sin revisiones.')));
      r.revisiones.forEach(function (x) {
        var tr = $('<tr>');
        [x.fecha, x.tipo, x.resultado, x.nueva_fecha_vence || '', x.observacion || ''].forEach(function (c) { tr.append($('<td>').text(c)); });
        cuerpo.append(tr);
      });
    });
    $('#modal-historial').modal('show');
  });
}(jQuery));
