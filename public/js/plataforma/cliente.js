// Ficha del cliente: modal de anulacion de pagos.
(function ($) {
  'use strict';

  $('.js-anular-pago').on('click', function () {
    var b = $(this);
    var form = $('#form-anular-pago');
    form.attr('action', form.data('base') + encodeURIComponent(b.data('id')) + '/anular');
    form.find('.js-titulo').text(b.data('texto'));
    form.find('[name="motivo"]').val('');
    $('#modal-anular-pago').modal('show');
  });
}(jQuery));
