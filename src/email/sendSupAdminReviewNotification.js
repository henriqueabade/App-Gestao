const transporter = require('./transporter');

function resolveSupAdminRecipient() {
  const recipients = [process.env.SUP_ADMIN_EMAIL, process.env.ADMIN_EMAIL];
  const email = recipients.find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!email) {
    console.warn('SUP_ADMIN_EMAIL não configurado. Notificação não será enviada.');
  }
  return email;
}

function buildApprovalLink(token) {
  if (!token) {
    return null;
  }

  const bases = [process.env.APP_URL, process.env.API_URL, process.env.API_BASE_URL];
  const base = bases.find(value => typeof value === 'string' && value.trim().length > 0);
  const pathname = '/api/usuarios/aprovar';

  if (!base) {
    return `${pathname}?token=${encodeURIComponent(token)}`;
  }

  try {
    const url = new URL(pathname, base);
    url.searchParams.set('token', token);
    return url.toString();
  } catch (err) {
    console.warn('Não foi possível montar URL de aprovação automática, usando caminho relativo.', err);
    return `${pathname}?token=${encodeURIComponent(token)}`;
  }
}

async function sendSupAdminReviewNotification({ usuarioNome, usuarioEmail, motivo, acaoRecomendada, tokenAprovacao }) {
  const to = resolveSupAdminRecipient();
  if (!to) return;

  const approvalUrl = buildApprovalLink(tokenAprovacao);
  const callToAction = approvalUrl
    ? `
    <p style="margin: 24px 0; text-align: center;">
      <a href="${approvalUrl}" style="display: inline-block; padding: 14px 28px; background-color: #16a34a; color: #fff; text-decoration: none; border-radius: 9999px; font-weight: 600;">Ativar usuário</a>
    </p>
    <p style="font-size: 14px; color: #64748b; word-break: break-all;">Ou copie e cole este link no navegador: <a href="${approvalUrl}" style="color: #2563eb;">${approvalUrl}</a></p>
  `
    : '<p>Acesse o painel administrativo para revisar e tomar as ações necessárias.</p>';

  const html = `
    <p>Olá! 👋</p>
    <p>O usuário <strong>${usuarioNome || usuarioEmail}</strong> (${usuarioEmail}) gerou uma atualização no fluxo de cadastro.</p>
    <p><strong>Motivo:</strong> ${motivo || 'Confirmação de e-mail recebida'}.</p>
    ${acaoRecomendada ? `<p>${acaoRecomendada}</p>` : ''}
    ${callToAction}
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
