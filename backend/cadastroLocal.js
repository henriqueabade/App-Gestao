// backend/cadastroLocal.js — o cadastro da tela de login com BANCO=DEV.
//
// Em produção quem cadastra, manda os e-mails e atende o link de confirmação
// é a API (Santissimo-db-API/cadastro). Com o banco local não há API: este
// arquivo liga a mesma regra (backend/cadastroPublico.js, cópia da API) ao
// PostgreSQL local e serve o link pelo Express embarcado (server.js).
//
// E-mail no DEV: sai pelo src/lib/mail quando EMAIL_SENDING_ENABLED está
// ligado; desligado, o link aparece no terminal (como o código da senha).
// ------------------------------------------------------------------

const { criarCadastro, pagina } = require('./cadastroPublico');

let cadastro = null;

async function colunasDe(tabela) {
  const { rows } = await require('./localDatabase').query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    ['public', tabela]
  );
  return rows.map(r => r.column_name);
}

const ASSUNTOS = {
  confirmacao: 'Confirme o seu cadastro',
  aguardando: 'Novo cadastro aguardando liberação',
  naoReconhecido: 'Cadastro não reconhecido pelo dono do e-mail',
  liberado: 'Seu acesso foi liberado'
};

function textoDoEmail(qual, dados) {
  if (qual === 'confirmacao') {
    return `Confirme o seu cadastro: ${dados.confirmarUrl}\nNão foi você? ${dados.naoReconhecoUrl}\nO link vale por ${dados.validadeHoras} horas. Depois, o administrador ainda precisa liberar o seu acesso.`;
  }
  if (qual === 'aguardando') {
    return `${dados.usuarioNome || dados.usuarioEmail} (${dados.usuarioEmail}) confirmou o e-mail e aguarda a liberação do acesso em Usuários.`;
  }
  if (qual === 'naoReconhecido') {
    return `O dono do e-mail ${dados.usuarioEmail} avisou que não fez o cadastro "${dados.usuarioNome}". Confira em Usuários.`;
  }
  return 'O administrador liberou o seu acesso. Você já pode entrar com o seu e-mail e a sua senha.';
}

function remetente(qual) {
  return async dados => {
    const texto = textoDoEmail(qual, dados);
    try {
      const { sendMail } = require('../src/lib/mail');
      const envio = await sendMail({
        envelope: { from: process.env.FROM_EMAIL, to: dados.email },
        fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
        to: dados.email,
        subject: ASSUNTOS[qual],
        text: texto
      });
      if (envio?.enviado) return envio;
    } catch (err) {
      console.warn(`[cadastro DEV] e-mail "${qual}" não saiu:`, err?.message || err);
    }
    console.info(`[cadastro DEV] e-mail "${qual}" para ${dados.email} (envio desligado):\n${texto}`);
    return { enviado: false, motivo: 'envio de e-mail desligado no banco DEV (o link está no terminal)' };
  };
}

function obter() {
  if (!cadastro) {
    cadastro = criarCadastro({
      pool: require('./localDatabase'),
      bcrypt: require('bcrypt'),
      mensagemDaSenha: senha => require('../src/js/utils/senha-forte').mensagem(senha) || '',
      colunasDe,
      enviar: Object.fromEntries(Object.keys(ASSUNTOS).map(qual => [qual, remetente(qual)]))
    });
  }
  return cadastro;
}

module.exports = {
  cadastrar: (corpo, contexto) => obter().cadastrar(corpo, contexto),
  /** As duas páginas do link do e-mail, para o Express embarcado. */
  paginaConfirmar: pagina(token => obter().confirmar(token)),
  paginaNaoReconheco: pagina(token => obter().naoReconheco(token))
};
