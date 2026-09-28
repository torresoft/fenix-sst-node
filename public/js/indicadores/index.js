// Indicadores: ficha tecnica en modal.
(function ($) {
  'use strict';

  $('.js-ficha').on('click', function () {
    var b = $(this);
    var form = $('#form-ficha');
    form.find('[name="indicador_codigo"]').val(b.data('codigo'));
    form.find('.js-nombre').text(b.data('nombre'));
    form.find('[name="meta"]').val(b.data('meta'));
    form.find('[name="sentido"]').val(b.data('sentido'));
    form.find('[name="responsable"]').val(b.data('responsable'));
    form.find('[name="fuente"]').val(b.data('fuente'));
    $('#modal-ficha').modal('show');
  });
}(jQuery));
