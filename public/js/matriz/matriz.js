// Matriz legal: modal de evaluacion (con carga de documentos vigentes) y revision de boletines.
(function ($) {
  'use strict';

  var documentos = null;

  function cargarDocumentos() {
    if (documentos) return $.Deferred().resolve(documentos).promise();
    return $.get('/matriz-legal/documentos').then(function (r) {
      documentos = r.documentos || [];
      return documentos;
    });
  }

  $('.js-evaluar').on('click', function () {
    var b = $(this);
    var form = $('#form-evaluar');
    var select = form.find('[name="documentos"]');
    var marcados = String(b.data('evidencias') || '').split(',').filter(Boolean);

    form.find('[name="norma_codigo"]').val(b.data('norma'));
    form.find('.js-norma').text(b.data('norma'));
    form.find('.js-objeto').text(b.data('objeto'));
    form.find('[name="estado_cumplimiento"]').val(b.data('estado'));
    form.find('[name="responsable_id"]').val(String(b.data('responsable') || ''));
    form.find('[name="observacion"]').val(b.data('observacion') || '');
    select.empty().prop('disabled', true);

    cargarDocumentos().done(function (docs) {
      $.each(docs, function (i, d) {
        select.append($('<option>').val(d.id).text(d.codigo + ' v' + d.version + ' - ' + d.titulo)
          .prop('selected', marcados.indexOf(String(d.id)) !== -1));
      });
      if (!docs.length) select.append($('<option disabled>').text('La empresa no tiene documentos vigentes'));
      select.prop('disabled', false);
    });
    $('#modal-evaluar').modal('show');
  });

  $('.js-revisar').on('click', function () {
    var b = $(this);
    var form = $('#form-revisar');
    form.attr('action', '/matriz-legal/boletines/' + encodeURIComponent(b.data('id')) + '/revisar');
    form.find('.js-norma').text(b.data('norma'));
    form.find('[name="observacion"]').val('');
    $('#modal-revisar').modal('show');
  });
}(jQuery));
