const transporter = require('./transporter');

function resolveSupAdminRecipient() {
  const recipients = [process.env.SUP_ADMIN_EMAIL, process.env.ADMIN_EMAIL];
  const email = recipients.find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!email) {
    console.warn('SUP_ADMIN_EMAIL não configurado. Notificação não será enviada.');
  }
  return email;
}

async function sendSupAdminReviewNotification({ usuarioNome, usuarioEmail, motivo, acaoRecomendada }) {
  const to = resolveSupAdminRecipient();
  if (!to) return;

  const html = `
    <p>Olá! 👋</p>
    <p>O usuário <strong>${usuarioNome || usuarioEmail}</strong> (${usuarioEmail}) gerou uma atualização no fluxo de cadastro.</p>
    <p><strong>Motivo:</strong> ${motivo || 'Confirmação de e-mail recebida'}.</p>
    ${acaoRecomendada ? `<p>${acaoRecomendada}</p>` : ''}
    <p>Acesse o painel administrativo para revisar e tomar as ações necessárias.</p>
    <p>Equipe Santíssimo Decor</p>
  `;

  await transporter.sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    from: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Ação necessária - Revisão de cadastro de usuário',
    html
  });
}

module.exports = { sendSupAdminReviewNotification };
