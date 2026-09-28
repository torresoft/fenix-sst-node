// Formulario de documento: bloques segun el tipo (archivo o referencia, firma), vencimiento sugerido.
(function ($) {
  'use strict';

  var form = $('#form-documento');
  var tipo = $('#d-tipo');
  var modalidad = $('#d-modalidad');
  var opciones = modalidad.find('option').clone();

  function sugerirVence(fecha, meses) {
    if (!fecha || !meses) return '';
    var p = fecha.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + Number(meses), 1));
    var ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(p[2], ultimo) - 1);
    return d.toISOString().slice(0, 10);
  }

  function aplicarTipo() {
    var op = tipo.find('option:selected');
    var referencia = op.data('referencia') === 1;
    var firma = op.data('firma') === 1;
    var permitidas = String(op.data('modalidades') || '').split(',').filter(Boolean);

    form.find('.js-bloque-archivo').toggleClass('d-none', referencia);
    form.find('.js-bloque-referencia').toggleClass('d-none', !referencia);
    form.find('[name="referencia_custodio"]').prop('required', referencia);
    form.find('.js-aviso-salud').toggleClass('d-none', op.data('modulo') !== 'M09');
    form.find('.js-bloque-firma').toggleClass('d-none', !firma);

    var actual = modalidad.val() || modalidad.data('actual');
    modalidad.empty().append(opciones.filter(function () { return permitidas.indexOf(this.value) !== -1; }).clone());
    if (permitidas.indexOf(actual) !== -1) modalidad.val(actual);
    modalidad.prop('required', firma).trigger('change');

    var sugerido = sugerirVence($('#d-fecha').val(), op.data('vigencia'));
    form.find('.js-sugerencia').text(sugerido ? 'Sugerido por la vigencia del tipo: ' + sugerido : '');
    if (sugerido && !$('#d-vence').val()) $('#d-vence').val(sugerido);
  }

  modalidad.on('change', function () {
    var externa = ['manuscrita', 'digital_externa'].indexOf(this.value) !== -1 && !form.find('.js-bloque-firma').hasClass('d-none');
    form.find('.js-bloque-externos').toggleClass('d-none', !externa);
    form.find('[name="firmantes_externos"]').prop('required', externa);
  });

  tipo.on('change', aplicarTipo);
  $('#d-fecha').on('change', aplicarTipo);
  $('#d-archivo').on('change', function () {
    var f = this.files && this.files[0];
    $(this).next('.custom-file-label').text(f ? f.name : 'Seleccionar archivo');
  });
  aplicarTipo();
}(jQuery));
