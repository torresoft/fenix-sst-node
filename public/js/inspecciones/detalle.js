// Inspeccion: filas dinamicas de hallazgos.
(function ($) {
  'use strict';

  var cuerpo = $('.js-hallazgos');

  $('.js-agregar').on('click', function () {
    var fila = cuerpo.find('.js-hallazgo').first().clone();
    fila.find('input').val('');
    fila.find('select').prop('selectedIndex', 0);
    cuerpo.append(fila);
  });

  cuerpo.on('click', '.js-quitar', function () {
    if (cuerpo.find('.js-hallazgo').length > 1) $(this).closest('.js-hallazgo').remove();
    else cuerpo.find('input').val('');
  });
}(jQuery));
