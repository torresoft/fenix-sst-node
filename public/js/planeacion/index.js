// Planeacion: selector de plan y modales de actividades y gestion del cambio.
(function ($) {
  'use strict';

  $('.js-plan').on('change', function () { window.location.href = '/planeacion?plan=' + encodeURIComponent(this.value); });

  $('.js-cerrar').on('click', function () {
    var form = $('#form-cerrar').attr('action', '/planeacion/actividades/' + encodeURIComponent($(this).data('id')) + '/cerrar');
    form.find('.js-titulo').text($(this).data('descripcion'));
    form.find('[name="observacion"]').val('');
    $('#modal-cerrar').modal('show');
  });

  $('.js-reprogramar').on('click', function () {
    var form = $('#form-reprogramar').attr('action', '/planeacion/actividades/' + encodeURIComponent($(this).data('id')) + '/reprogramar');
    form.find('[name="fecha_fin"]').val($(this).data('fin'));
    $('#modal-reprogramar').modal('show');
  });

  $('.js-cambio').on('click', function () {
    var b = $(this);
    var form = $('#form-avance-cambio').attr('action', '/planeacion/cambios/' + encodeURIComponent(b.data('id')));
    var opciones = b.data('estado') === 'en_evaluacion'
      ? [['aprobar', 'Aprobar con esta evaluaci\u00f3n'], ['evaluar', 'Guardar evaluaci\u00f3n'], ['rechazar', 'Rechazar']]
      : [['implementar', 'Marcar implementado'], ['rechazar', 'Rechazar']];
    form.find('.js-titulo').text(b.data('descripcion'));
    form.find('[name="impacto_sst"]').val(b.data('impacto') || '');
    form.find('.js-evaluacion').toggle(b.data('estado') === 'en_evaluacion');
    form.find('.js-accion-cambio').empty().append(opciones.map(function (o) { return $('<option>').val(o[0]).text(o[1]); }));
    $('#modal-avance-cambio').modal('show');
  });
}(jQuery));
