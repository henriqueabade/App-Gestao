document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const form = document.getElementById('resetForm');
  const msg = document.getElementById('message');
  const notificationContainer = document.getElementById('notification');

  function showToast(message, type = 'info') {
    const div = document.createElement('div');
    let toastClass = 'toast-info';
    if (type === 'success') toastClass = 'toast-success';
    else if (type === 'error') toastClass = 'toast-error';
    div.className = `toast ${toastClass}`;
    div.textContent = message;
    notificationContainer.appendChild(div);
    setTimeout(() => {
      div.classList.add('opacity-0');
      setTimeout(() => div.remove(), 500);
    }, 3000);
  }

  function animateSuccess() {
    const overlay = document.getElementById('resetOverlay');
    overlay.classList.remove('hidden');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      overlay.innerHTML = `
        <div class="text-center">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p class="mt-4">Senha redefinida!<br>Faça login com sua nova senha.</p>
        </div>`;
      setTimeout(() => window.location.href = 'login.html', 1500);
      return;
    }

    overlay.innerHTML = `
      <svg id="animSvg" width="120" height="120" viewBox="0 0 64 64" class="stroke-current">
        <g id="lock">
          <rect x="20" y="28" width="24" height="20" rx="2" />
          <path d="M24 28v-6a8 8 0 0116 0v6" />
        </g>
        <circle id="pulse" cx="32" cy="32" r="18" stroke="#A394A7" opacity="0" />
        <circle id="circle" cx="32" cy="32" r="20" stroke-width="4" opacity="0" />
        <path id="check" d="M24 34l6 6 12-12" stroke="#9FE4A6" stroke-width="4" fill="none" stroke-dasharray="30" stroke-dashoffset="30" opacity="0" />
        <g id="confetti" opacity="0">
          <circle cx="16" cy="32" r="2" fill="#9FE4A6" fill-opacity="0.7" />
          <circle cx="48" cy="32" r="2" fill="#cbb7e5" fill-opacity="0.7" />
          <circle cx="32" cy="16" r="2" fill="#9FE4A6" fill-opacity="0.7" />
          <circle cx="32" cy="48" r="2" fill="#cbb7e5" fill-opacity="0.7" />
        </g>
      </svg>`;

    const tl = gsap.timeline({ onComplete: () => {
      gsap.delayedCall(0.7, () => {
        gsap.to(overlay, { opacity: 0, duration: 0.5, onComplete: () => window.location.href = 'login.html' });
      });
    }});

    tl.from('#lock', { scale: 0, transformOrigin: '50% 50%', duration: 0.3, ease: 'back.out(1.7)' })
      .fromTo('#pulse', { scale: 0, opacity: 1 }, { scale: 1.1, opacity: 0, stroke: '#cbb7e5', duration: 0.8, ease: 'expo.out' }, 0.3)
      .to('#lock', { rotation: 15, duration: 0.2, ease: 'power1.out' }, 1.1)
      .to('#lock', { opacity: 0, duration: 0.2 }, 1.1)
      .fromTo('#circle', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2 }, 1.1)
      .fromTo('#check', { opacity: 1, strokeDashoffset: 30 }, { strokeDashoffset: 0, duration: 0.5, ease: 'elastic.out(1, 0.5)' }, 1.3)
      .to('#confetti', { opacity: 1, duration: 0.01 }, 1.3)
      .to('#confetti circle', { y: -10, opacity: 0, duration: 0.5, stagger: 0.05, ease: 'power2.out' }, 1.3);
  }


  feather.replace();
  const togglePassword = document.getElementById('togglePassword');
  const pwd            = document.getElementById('newPassword');

  function toggleVisibility() {
    const isHidden = pwd.type === 'password';
    pwd.type = isHidden ? 'text' : 'password';
    togglePassword.setAttribute('aria-label', isHidden ? 'Ocultar senha' : 'Mostrar senha');
    togglePassword.querySelector('i').dataset.feather = isHidden ? 'eye-off' : 'eye';
    feather.replace();
  }

  togglePassword.addEventListener('click', toggleVisibility);
  togglePassword.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleVisibility();
    }
  });

  if (!token) {
    msg.textContent = 'Token inválido';
    form.querySelector('button').disabled = true;
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const newPassword = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    if (newPassword !== confirm) {
      msg.textContent = 'Senhas não coincidem';
      return;
    }
    try {
      const resp = await fetch('/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });
      if (resp.ok) {
        animateSuccess();
      } else {
        msg.textContent = 'Token inválido ou expirado';
      }
    } catch (err) {
      msg.textContent = 'Erro ao redefinir senha';
    }
  });
});
