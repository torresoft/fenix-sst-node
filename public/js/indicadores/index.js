// Indicadores: ficha tecnica en modal y registro manual guiado por la formula del indicador.
(function ($) {
  'use strict';

  $('.js-ficha').on('click', function () {
    var b = $(this);
    var form = $('#form-ficha');
    form.find('[name="indicador_codigo"]').val(b.data('codigo'));
    form.find('.js-nombre').text(b.data('nombre'));
    form.find('[name="meta"]').val(b.data('meta'));
    form.find('[name="sentido"]').val(b.data('sentido'));
    form.find('[name="responsable"]').val(b.data('responsable'));
    form.find('[name="fuente"]').val(b.data('fuente'));
    $('#modal-ficha').modal('show');
  });

  var manual = $('#modal-manual');
  var campo = function (n) { return manual.find('[name="' + n + '"]'); };

  function resultado() {
    var o = manual.find('.js-indicador option:selected');
    var num = Number(campo('numerador').val());
    var den = Number(campo('denominador').val());
    var factor = Number(o.data('factor')) || 100;
    var ok = campo('numerador').val() !== '' && den > 0;
    manual.find('.js-resultado').text(ok ? (Math.round((num / den) * factor * 100) / 100).toLocaleString('es-CO') : '-');
  }

  // Etiquetas, formula y periodo segun el indicador elegido; estructura = existe (1) / no existe (0) sobre 1.
  function indicador() {
    var o = manual.find('.js-indicador option:selected');
    var estructura = o.data('tipo') === 'estructura';
    var anual = o.data('periodicidad') === 'anual';
    manual.find('.js-formula').text(o.data('formula') || '');
    manual.find('.js-et-numerador').text(o.data('numerador') || (estructura ? 'Existe (1 = sí, 0 = no)' : 'Ejecutado'));
    manual.find('.js-et-denominador').text(o.data('denominador') || (estructura ? 'Base' : 'Programado'));
    campo('denominador').prop('readonly', estructura);
    if (estructura) campo('denominador').val(1);
    var periodo = campo('periodo');
    var mes = String(periodo.data('mes'));
    periodo.attr('placeholder', anual ? 'AAAA' : 'AAAA-MM');
    if (anual && periodo.val().length === 7) periodo.val(periodo.val().slice(0, 4));
    if (!anual && periodo.val().length === 4) periodo.val(periodo.val() + mes.slice(4));
    resultado();
  }

  manual.find('.js-indicador').on('change', indicador);
  manual.find('[name="numerador"], [name="denominador"]').on('input', resultado);
  if (manual.length) indicador();
}(jQuery));
