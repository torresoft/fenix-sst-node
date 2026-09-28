// Permisos: lista de verificacion segun el tipo y vista previa de la verificacion de cada ejecutor.
(function ($) {
  'use strict';

  var form = $('#form-permiso');
  var cuerpo = form.find('.js-ejecutores');

  function tipoActual() { return form.find('.js-tipo').val(); }

  function mostrarLista() {
    form.find('.js-lista').each(function () {
      var activa = $(this).data('tipo') === tipoActual();
      $(this).toggleClass('d-none', !activa).find('input').prop('disabled', !activa).prop('required', activa);
    });
  }

  function celda(v) {
    var icono = v.ok ? 'fa-check-circle text-success' : 'fa-times-circle text-danger';
    return $('<div class="small">').append($('<i class="fas mr-1">').addClass(icono)).append(document.createTextNode(v.detalle));
  }

  function verificar(fila) {
    var id = fila.data('persona');
    var destino = fila.find('.js-verificacion').empty().text('Verificando...');
    $.get('/permisos/verificar', { persona_id: id, tipo: tipoActual(), fecha: form.find('.js-fecha').val() })
      .done(function (r) {
        var v = r.verificacion;
        destino.empty().append(celda(v.certificacion), celda(v.aptitud), celda(v.induccion));
        (v.advertencias || []).forEach(function (a) { destino.append($('<div class="small text-warning">').text(a)); });
        fila.toggleClass('table-danger', !v.ok);
      })
      .fail(function (x) { destino.text((x.responseJSON && x.responseJSON.error) || 'No se pudo verificar'); fila.addClass('table-danger'); });
  }

  function reverificar() { cuerpo.find('tr').each(function () { verificar($(this)); }); }

  form.find('.js-tipo').on('change', function () { mostrarLista(); reverificar(); });
  form.find('.js-fecha').on('change', reverificar);

  form.find('.js-persona').on('change', function () {
    var sel = $(this);
    var id = sel.val();
    if (!id || cuerpo.find('tr[data-persona="' + id + '"]').length) { sel.val(''); return; }
    var fila = $('<tr>').attr('data-persona', id).data('persona', id);
    fila.append($('<td>').append($('<input type="hidden" name="ejecutor">').val(id)).append(document.createTextNode(sel.find(':selected').text())));
    fila.append($('<td class="js-verificacion">'));
    fila.append($('<td class="text-center">').append($('<button type="button" class="btn btn-xs btn-default js-quitar"><i class="fas fa-times"></i></button>')));
    cuerpo.append(fila);
    sel.val('');
    verificar(fila);
  });

  cuerpo.on('click', '.js-quitar', function () { $(this).closest('tr').remove(); });

  mostrarLista();
}(jQuery));
