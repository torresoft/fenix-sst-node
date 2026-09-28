// Acciones de mejora: modal de cierre.
(function ($) {
  'use strict';

  $('.js-cerrar').on('click', function () {
    $('#form-cerrar').attr('action', '/acciones/' + encodeURIComponent($(this).data('id')) + '/cerrar').find('textarea').val('');
    $('#modal-cerrar').modal('show');
  });
}(jQuery));
