window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('notificationBtn');
  const badge = document.getElementById('notificationBadge');
  if (!btn || !badge) return;

  let currentUser = {};
  try {
    currentUser = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('user') || '{}');
  } catch (e) {
    currentUser = {};
  }

  const notifications = [
    {
      user: currentUser.nome || 'Sistema',
      message: 'Bem-vindo ao painel!'
        + (currentUser.perfil ? ` Perfil: ${currentUser.perfil}.` : ''),
      date: new Date()
    },
    {
      user: 'Suporte',
      message: 'Sua conta foi verificada com sucesso.',
      date: new Date(Date.now() - 3600000)
    }
  ];

  function formatDate(d) {
    try {
      return new Date(d).toLocaleString('pt-BR');
    } catch (e) {
      return '';
    }
  }

  function updateIcon() {
    if (notifications.length > 0) {
      btn.style.color = 'var(--color-primary)';
      badge.classList.remove('hidden');
    } else {
      btn.style.color = 'white';
      badge.classList.add('hidden');
    }
  }

  window.updateNotificationColor = updateIcon;

    btn.addEventListener('click', () => {
      const items = notifications
        .map(
          n => `
          <div class="px-4 py-2 border-b last:border-0 border-gray-100">
            <div class="font-semibold">${n.user}</div>
            <div class="text-xs text-gray-500">${formatDate(n.date)}</div>
            <div class="text-sm">${n.message}</div>
          </div>`
        )
        .join('');
      const content = `<div class="w-72 bg-white rounded-md shadow-lg text-gray-800">${
        items || '<div class="p-4 text-sm text-gray-600">Sem notificações</div>'
      }</div>`;
      const { popup } = createPopup(btn, content, {
        onHide: () => popup.remove()
      });
      notifications.length = 0;
      updateIcon();
    });

    updateIcon();
  });
