// Convivencia: filas dinamicas de grupos del consolidado psicosocial.
(function ($) {
  'use strict';

  var cuerpo = $('.js-grupos');

  $('.js-agregar-grupo').on('click', function () {
    var fila = cuerpo.find('.js-grupo').first().clone();
    fila.find('input').val('');
    fila.find('select').prop('selectedIndex', 0);
    cuerpo.append(fila);
  });

  cuerpo.on('click', '.js-quitar-grupo', function () {
    if (cuerpo.find('.js-grupo').length > 1) $(this).closest('.js-grupo').remove();
  });
}(jQuery));
