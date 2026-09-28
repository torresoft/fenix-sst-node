// Matriz de peligros: selector de version y modales de medidas de intervencion.
(function ($) {
  'use strict';

  $('.js-version').on('change', function () { Turbo.visit('/peligros/' + encodeURIComponent(this.value)); });

  $('.js-control').on('click', function () {
    var b = $(this);
    var form = $('#form-control').attr('action', '/peligros/items/' + encodeURIComponent(b.data('id')) + '/controles');
    form.trigger('reset').find('.js-titulo').text(b.data('peligro'));
    $('#modal-control').modal('show');
  });

  $('.js-cerrar-control').on('click', function () {
    var b = $(this);
    var form = $('#form-cerrar-control').attr('action', '/peligros/controles/' + encodeURIComponent(b.data('id')) + '/cerrar');
    form.find('.js-titulo').text(b.data('descripcion'));
    form.find('[name="observacion"]').val('');
    $('#modal-cerrar-control').modal('show');
  });
}(jQuery));
