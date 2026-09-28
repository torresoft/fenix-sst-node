// Autorizaciones: prepara el modal de registro con la persona y finalidad de la celda.
(function ($) {
  'use strict';

  $('.js-registrar').on('click', function () {
    var b = $(this);
    var form = $('#form-autorizacion');
    form.find('[name="persona_id"]').val(b.data('persona'));
    form.find('[name="finalidad"]').val(b.data('finalidad'));
    form.find('.js-nombre').text(b.data('nombre') + ' \u00b7 ' + b.data('finalidad-nombre'));
    form.find('[name="documento_id"] option').each(function () {
      var p = String($(this).data('persona') || '');
      $(this).toggle(!this.value || !p || p === String(b.data('persona')));
    });
    form.find('[name="documento_id"]').val('');
    $('#modal-autorizacion').modal('show');
  });
}(jQuery));
