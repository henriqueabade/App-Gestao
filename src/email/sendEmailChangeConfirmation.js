const { sendMail } = require('../lib/mail');
const { getLogoAttachment, renderLogoImage } = require('./logo');

function buildLink(pathname, token) {
  const bases = [process.env.APP_URL, process.env.API_URL, process.env.API_BASE_URL];
  const base = bases.find(value => typeof value === 'string' && value.trim());
  if (!base) {
    return `${pathname}?token=${encodeURIComponent(token)}`;
  }
  try {
    const url = new URL(pathname, base);
    url.searchParams.set('token', token);
    return url.toString();
  } catch (err) {
    console.warn('Não foi possível montar URL de confirmação de e-mail, usando caminho relativo.', err);
    return `${pathname}?token=${encodeURIComponent(token)}`;
  }
}

async function sendEmailChangeConfirmation({ to, nome, token, emailAtual }) {
  if (!to || !token) {
    throw new Error('Destinatário e token são obrigatórios para confirmar novo e-mail.');
  }

  const confirmUrl = buildLink('/api/usuarios/confirm-email', token);
  const saudacao = nome ? `Olá ${nome}!` : 'Olá!';
  const mensagemAtual = emailAtual ? `O endereço atual cadastrado é <strong>${emailAtual}</strong>.` : '';

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      ${renderLogoImage()}
      <p>${saudacao}</p>
      <p>Recebemos uma solicitação para alterar o seu e-mail de acesso ao painel Santíssimo Decor.</p>
      ${mensagemAtual}
      <p>Para confirmar o novo endereço, clique no botão abaixo. O link expira em 48 horas.</p>
      <p style="margin: 24px 0; text-align: center;">
        <a href="${confirmUrl}" style="display: inline-block; padding: 12px 20px; background-color: #0f766e; color: #fff; text-decoration: none; border-radius: 6px;">Confirmar novo e-mail</a>
      </p>
      <p>Se você não solicitou esta alteração, ignore este e-mail e mantenha seus dados como estão.</p>
      <p>Atenciosamente,<br>Equipe Santíssimo Decor</p>
    </div>
  `;

  await sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Confirme seu novo e-mail',
    html,
    attachments: [getLogoAttachment()]
  });
}

module.exports = { sendEmailChangeConfirmation };
