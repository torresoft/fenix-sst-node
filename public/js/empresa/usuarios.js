// Usuarios: modal de roles. El propio administrador no puede quitarse el rol de administrador.
(function ($) {
  'use strict';

  $('.js-roles').on('click', function () {
    var b = $(this);
    var form = $('#form-roles');
    var roles = String(b.data('roles') || '').split(',');
    form.attr('action', '/empresa/usuarios/' + encodeURIComponent(b.data('id')) + '/roles');
    form.find('.js-nombre').text(b.data('nombre'));
    form.find('[name="roles"]').each(function () {
      $(this).prop('checked', roles.indexOf(this.value) !== -1)
        .prop('disabled', b.data('yo') === 1 && this.value === 'admin_tenant');
    });
    $('#modal-roles').modal('show');
  });

  // Un checkbox deshabilitado no se envia: se reinyecta el rol de administrador propio.
  $('#form-roles').on('submit', function () {
    var admin = $(this).find('[name="roles"][value="admin_tenant"]:disabled:checked');
    if (admin.length) $('<input type="hidden" name="roles" value="admin_tenant">').appendTo(this);
  });
}(jQuery));
