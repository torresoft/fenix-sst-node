// Quimicos: modales de FDS y retiro.
(function ($) {
  'use strict';

  function abrir(modal, form, accion, nombre) {
    $(form).attr('action', accion).trigger('reset');
    $(modal).find('.js-nombre').text(nombre);
    $(modal).modal('show');
  }

  $('.js-fds').on('click', function () {
    abrir('#modal-fds', '#form-fds', '/quimicos/' + encodeURIComponent($(this).data('id')) + '/fds', $(this).data('nombre'));
  });

  $('.js-retirar').on('click', function () {
    abrir('#modal-retirar', '#form-retirar', '/quimicos/' + encodeURIComponent($(this).data('id')) + '/inactivar', $(this).data('nombre'));
  });
}(jQuery));
