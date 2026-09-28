// Detalle de documento: filas dinamicas de firmantes en la solicitud de firmas.
(function ($) {
  'use strict';

  var contenedor = $('.js-firmantes');
  var plantilla = contenedor.find('.js-firmante').first().clone();

  $('.js-agregar').on('click', function () {
    var fila = plantilla.clone();
    fila.find('select, input').val('');
    contenedor.append(fila);
  });

  contenedor.on('click', '.js-quitar', function () {
    if (contenedor.find('.js-firmante').length > 1) $(this).closest('.js-firmante').remove();
  });
}(jQuery));
