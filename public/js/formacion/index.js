// Formacion: registrar competencia desde la matriz.
(function ($) {
  'use strict';

  $('.js-competencia').on('click', function () {
    var b = $(this);
    var form = $('#form-competencia');
    form.find('[name="persona_id"]').val(b.data('persona'));
    form.find('[name="tipo"]').val(b.data('tipo'));
    form.find('.js-nombre').text(b.data('nombre'));
    form.find('[name="fecha_vence"], [name="entidad"], [name="horas"]').val('');
    $('#modal-competencia').modal('show');
  });

}(jQuery));
