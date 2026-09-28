// Ficha de persona: modales de reasignacion, retiro y anulacion de vinculaciones.
(function ($) {
  'use strict';

  var ruta = function (id, accion) { return '/personas/vinculaciones/' + encodeURIComponent(id) + '/' + accion; };

  $('.js-reasignar').on('click', function () {
    var b = $(this);
    var form = $('#form-reasignar').attr('action', ruta(b.data('id'), 'reasignar'));
    form.find('[name="cargo_id"]').val(String(b.data('cargo') || ''));
    form.find('[name="centro_trabajo_id"]').val(String(b.data('centro') || ''));
    $('#modal-reasignar').modal('show');
  });

  $('.js-retiro').on('click', function () {
    var b = $(this);
    var form = $('#form-retiro').attr('action', ruta(b.data('id'), 'retiro'));
    form.find('[name="fecha_retiro"]').attr('min', b.data('ingreso'));
    form.find('[name="motivo_retiro"]').val('');
    $('#modal-retiro').modal('show');
  });

  $('.js-anular').on('click', function () {
    $('#form-anular').attr('action', ruta($(this).data('id'), 'anular')).find('[name="observacion"]').val('');
    $('#modal-anular').modal('show');
  });
}(jQuery));
