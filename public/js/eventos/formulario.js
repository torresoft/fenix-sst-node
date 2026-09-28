// Registro de evento: campos segun el tipo; los criterios del art. 3 fuerzan gravedad minima "grave".
(function ($) {
  'use strict';

  var form = $('#form-evento');

  function aplicar() {
    var tipo = form.find('[name="tipo"]:checked').val();
    form.find('.js-accidente').toggleClass('d-none', tipo !== 'accidente');
    form.find('.js-enfermedad').toggleClass('d-none', tipo !== 'enfermedad');
    form.find('.js-ocurrencia input[name="fecha_ocurrencia"]').prop('required', tipo !== 'enfermedad');
    form.find('[name="fecha_diagnostico"]').prop('required', tipo === 'enfermedad');
    form.find('[name="persona_id"]').prop('required', tipo !== 'incidente');
    form.find('.js-req').toggleClass('d-none', tipo === 'incidente');
    if (tipo !== 'accidente') form.find('.js-criterio').prop('checked', false);
  }

  form.on('change', '[name="tipo"]', aplicar);
  form.on('change', '.js-criterio', function () {
    var gravedad = $('#e-gravedad');
    if (form.find('.js-criterio:checked').length && gravedad.val() === 'leve') gravedad.val('grave');
  });
  aplicar();
}(jQuery));
