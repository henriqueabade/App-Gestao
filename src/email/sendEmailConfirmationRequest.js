const { sendMail } = require('../lib/mail');

function buildLink(pathname, token) {
  const bases = [process.env.APP_URL, process.env.API_URL, process.env.API_BASE_URL];
  const base = bases.find((value) => typeof value === 'string' && value.trim().length > 0);
  if (!base) {
    return `${pathname}?token=${encodeURIComponent(token)}`;
  }
  try {
    const url = new URL(pathname, base);
    url.searchParams.set('token', token);
    return url.toString();
  } catch (err) {
    console.warn('Não foi possível montar URL de confirmação, usando caminho relativo.', err);
    return `${pathname}?token=${encodeURIComponent(token)}`;
  }
}

async function sendEmailConfirmationRequest({ to, nome, token }) {
  if (!to || !token) {
    throw new Error('Destinatário e token são obrigatórios para enviar confirmação.');
  }

  const confirmarUrl = buildLink('/api/usuarios/confirmar-email', token);
  const reportarUrl = buildLink('/api/usuarios/reportar-email-incorreto', token);

  const html = `
    <p>Olá ${nome || 'there'}! 👋</p>
    <p>Recebemos uma solicitação de cadastro para este e-mail na plataforma Santíssimo Decor.</p>
    <p>Confirme abaixo se tudo está correto:</p>
    <p style="margin: 16px 0; text-align: center;">
      <a href="${confirmarUrl}" style="display: inline-block; padding: 12px 20px; background-color: #16a34a; color: #fff; text-decoration: none; border-radius: 6px; margin-right: 12px;">Confirmar cadastro</a>
      <a href="${reportarUrl}" style="display: inline-block; padding: 12px 20px; background-color: #dc2626; color: #fff; text-decoration: none; border-radius: 6px;">Não reconheço</a>
    </p>
    <p>Se você não solicitou, basta clicar em “Não reconheço” e nossa equipe será avisada imediatamente.</p>
    <p>Este link expira em 48 horas.</p>
    <p>Atenciosamente,<br>Equipe Santíssimo Decor</p>
  `;

  await sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Confirme seu cadastro',
    html
  });
}

module.exports = { sendEmailConfirmationRequest };
