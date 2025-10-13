const transporter = require('./transporter');

async function sendUserActivationNotice({ to, nome }) {
  if (!to) {
    throw new Error('Destinatário é obrigatório para enviar aviso de ativação.');
  }

  const html = `
    <p>Olá ${nome || 'Usuário'}! 🎉</p>
    <p>Boas notícias! Seu acesso à plataforma Santíssimo Decor foi liberado.</p>
    <p>Você já pode fazer login com seu e-mail e senha cadastrados.</p>
    <p>Caso não tenha sido você quem solicitou, responda este e-mail imediatamente para investigarmos.</p>
    <p>Bom trabalho!<br>Equipe Santíssimo Decor</p>
  `;

  await transporter.sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    from: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Seu acesso foi liberado',
    html
  });
}

module.exports = { sendUserActivationNotice };
