// Detalle de evento: modal para cerrar acciones del plan.
(function ($) {
  'use strict';

  $('.js-cerrar-accion').on('click', function () {
    var b = $(this);
    var form = $('#form-accion');
    form.attr('action', window.location.pathname.replace(/\/$/, '') + '/acciones/' + encodeURIComponent(b.data('id')) + '/cerrar');
    form.find('.js-titulo').text(b.data('descripcion'));
    form.find('[name="observacion"]').val('');
    $('#modal-accion').modal('show');
  });
}(jQuery));
