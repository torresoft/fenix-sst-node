// Autoevaluacion: modales de gestion.
(function ($) {
  'use strict';

  var documentos = null;
  function cargarDocumentos() {
    if (documentos) return $.Deferred().resolve(documentos).promise();
    return $.get('/autoevaluacion/documentos').then(function (r) {
      documentos = r.documentos || [];
      return documentos;
    });
  }

  $('.js-evidencia').on('click', function () {
    var b = $(this);
    var form = $('#form-evidencia');
    var select = form.find('[name="documentos"]');
    var marcados = String(b.data('docs') || '').split(',').filter(Boolean);
    form.find('[name="numeral"]').val(b.data('numeral'));
    form.find('.js-titulo').text(b.data('numeral') + ' ' + b.data('nombre'));
    select.empty().prop('disabled', true);
    cargarDocumentos().done(function (docs) {
      $.each(docs, function (i, d) {
        select.append($('<option>').val(d.id).text(d.codigo + ' v' + d.version + ' - ' + d.titulo)
          .prop('selected', marcados.indexOf(String(d.id)) !== -1));
      });
      if (!docs.length) select.append($('<option disabled>').text('La empresa no tiene documentos vigentes'));
      select.prop('disabled', false);
    });
    $('#modal-evidencia').modal('show');
  });

  $('.js-noaplica').on('click', function () {
    var b = $(this);
    var form = $('#form-noaplica');
    form.find('[name="numeral"]').val(b.data('numeral'));
    form.find('.js-titulo').text(b.data('numeral') + ' ' + b.data('nombre'));
    form.find('[name="justificacion"]').val(b.data('justificacion') || '');
    $('#modal-noaplica').modal('show');
  });

  $('.js-cerrar-accion').on('click', function () {
    var b = $(this);
    var form = $('#form-accion');
    var base = window.location.pathname.replace(/\/$/, '');
    form.attr('action', base + '/acciones/' + encodeURIComponent(b.data('id')) + '/cerrar');
    form.find('.js-titulo').text(b.data('descripcion'));
    form.find('[name="observacion"]').val('');
    $('#modal-accion').modal('show');
  });
}(jQuery));
