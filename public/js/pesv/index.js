// PESV: modales de avance por paso, renovacion e inactivacion de vehiculos.
(function ($) {
  'use strict';

  $('.js-avance').on('click', function () {
    var b = $(this);
    var form = $('#form-avance');
    form.find('.js-nombre').text(b.data('paso') + ' · ' + b.data('nombre'));
    form.find('[name="paso_codigo"]').val(b.data('paso'));
    form.find('[name="estado"]').val(b.data('estado') === 'no_iniciado' ? 'en_proceso' : b.data('estado'));
    form.find('[name="observacion"]').val('');
    $('#modal-avance').modal('show');
  });

  function abrir(modal, form, accion, placa) {
    $(form).attr('action', accion).trigger('reset');
    $(modal).find('.js-placa').text(placa);
    $(modal).modal('show');
  }

  $('.js-renovar').on('click', function () {
    abrir('#modal-renovar', '#form-renovar', '/pesv/vehiculos/' + encodeURIComponent($(this).data('id')) + '/renovar', $(this).data('placa'));
  });

  $('.js-inactivar').on('click', function () {
    abrir('#modal-inactivar', '#form-inactivar', '/pesv/vehiculos/' + encodeURIComponent($(this).data('id')) + '/inactivar', $(this).data('placa'));
  });
}(jQuery));
