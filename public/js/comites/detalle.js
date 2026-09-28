// Comite: modales de acta, compromisos, retiro de miembros y anulacion de sesiones.
(function ($) {
  'use strict';

  function abrir(modal, form, accion) {
    $(form).attr('action', accion);
    $(modal).modal('show');
  }

  $('.js-tipo-sesion').on('change', function () {
    $('.js-evento').toggleClass('d-none', this.value !== 'extraordinaria');
    if (this.value !== 'extraordinaria') $('.js-evento select').val('');
  });

  $('.js-acta').on('click', function () {
    $('#form-acta .js-fecha').text($(this).data('fecha'));
    abrir('#modal-acta', '#form-acta', '/comites/sesiones/' + encodeURIComponent($(this).data('id')) + '/acta');
  });

  $('.js-compromiso').on('click', function () {
    var form = $('#form-compromiso');
    form.trigger('reset').find('[name="fecha_limite"]').attr('min', $(this).data('fecha'));
    abrir('#modal-compromiso', form, '/comites/sesiones/' + encodeURIComponent($(this).data('id')) + '/compromisos');
  });

  $('.js-cerrar-compromiso').on('click', function () {
    $('#form-cerrar-compromiso .js-titulo').text($(this).data('descripcion'));
    abrir('#modal-cerrar-compromiso', '#form-cerrar-compromiso', '/comites/compromisos/' + encodeURIComponent($(this).data('id')) + '/cerrar');
  });

  $('.js-retirar').on('click', function () {
    $('#form-retirar .js-nombre').text($(this).data('nombre'));
    abrir('#modal-retirar', '#form-retirar', '/comites/miembros/' + encodeURIComponent($(this).data('id')) + '/retirar');
  });

  $('.js-anular-sesion').on('click', function () {
    abrir('#modal-anular-sesion', '#form-anular-sesion', '/comites/sesiones/' + encodeURIComponent($(this).data('id')) + '/anular');
  });
}(jQuery));
