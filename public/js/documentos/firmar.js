// Firma: solicita el codigo de un solo uso (el CSRF va en la cabecera via ajaxSetup).
(function ($) {
  'use strict';

  $('.js-codigo').on('click', function () {
    var b = $(this);
    var estado = $('.js-codigo-estado');
    b.prop('disabled', true);
    $.post(b.data('url'))
      .done(function (r) {
        estado.removeClass('text-danger').addClass('text-success').text('C\u00f3digo enviado a ' + r.destino + '. Vence en 10 minutos.');
        $('#f-codigo').trigger('focus');
      })
      .fail(function (xhr) {
        var r = xhr.responseJSON || {};
        estado.removeClass('text-success').addClass('text-danger').text(r.mensaje || 'No se pudo enviar el c\u00f3digo');
      })
      .always(function () {
        setTimeout(function () { b.prop('disabled', false); }, 30000);
      });
  });
}(jQuery));
