// Informe del auditor: impresion (el navegador permite guardar como PDF).
(function ($) {
  'use strict';

  $('.js-imprimir').on('click', function () {
    $('.collapsed-card').removeClass('collapsed-card').find('.card-body').show();
    window.print();
  });
}(jQuery));
