const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('./db');
const { sendSupAdminReviewNotification } = require('../src/email/sendSupAdminReviewNotification');
const { sendUserActivationNotice } = require('../src/email/sendUserActivationNotice');

const router = express.Router();

// GET /api/usuarios/lista
router.get('/lista', async (_req, res) => {
  try {
    const meta = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usuarios'`
    );

    const colunas = meta.rows.map(row => row.column_name);
    const selecionar = ['u.id', 'u.nome', 'u.email', 'u.verificado', 'u.perfil'];

    const garantirColuna = (nome, alias) => {
      if (colunas.includes(nome)) {
        selecionar.push(`u.${nome}${alias && alias !== nome ? ` AS ${alias}` : ''}`);
        return true;
      }
      return false;
    };

    garantirColuna('ultimo_login_em', 'ultimo_login_em') ||
      garantirColuna('ultimo_login', 'ultimo_login_em');

    garantirColuna('ultima_atividade_em', 'ultima_atividade_em') ||
      garantirColuna('ultima_atividade', 'ultima_atividade_em');

    garantirColuna('ultima_alteracao', 'ultima_alteracao') ||
      garantirColuna('ultima_acao_em', 'ultima_alteracao') ||
      garantirColuna('ultima_alteracao_em', 'ultima_alteracao');

    garantirColuna('ultima_entrada', 'ultima_entrada') ||
      garantirColuna('ultima_entrada_em', 'ultima_entrada');
    garantirColuna('ultima_saida', 'ultima_saida') ||
      garantirColuna('ultima_saida_em', 'ultima_saida');

    garantirColuna('hora_ativacao', 'hora_ativacao');
    garantirColuna('status', 'status');
    garantirColuna('email_confirmado', 'email_confirmado');
    garantirColuna('email_confirmado_em', 'email_confirmado_em');
    garantirColuna('status_atualizado_em', 'status_atualizado_em');

    garantirColuna('local_ultima_acao', 'local_ultima_acao') ||
      garantirColuna('local_ultima_alteracao', 'local_ultima_acao');

    garantirColuna('especificacao_ultima_acao', 'especificacao_ultima_acao') ||
      garantirColuna('especificacao_ultima_alteracao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_alteracao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao', 'especificacao_ultima_acao');

    const query = `SELECT ${selecionar.join(', ')} FROM usuarios u ORDER BY u.nome`;
    const result = await pool.query(query);

    const usuarios = result.rows.map(formatarUsuario);

    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

const normalizarStatus = body => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  if (typeof body.status === 'string') {
    const valor = body.status.trim().toLowerCase();
    if (valor === 'ativo') return 'ativo';
    if (valor === 'inativo' || valor === 'não confirmado' || valor === 'nao_confirmado') {
      return 'nao_confirmado';
    }
    if (valor === 'aguardando aprovação' || valor === 'aguardando_aprovacao') {
      return 'aguardando_aprovacao';
    }
  }

  if (typeof body.verificado === 'boolean') {
    return body.verificado ? 'ativo' : 'nao_confirmado';
  }

  if (typeof body.ativo === 'boolean') {
    return body.ativo ? 'ativo' : 'nao_confirmado';
  }

  return undefined;
};

const renderMensagemHtml = (titulo, mensagem) => `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${titulo}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .card { background: rgba(15, 23, 42, 0.85); border-radius: 12px; padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.6); }
      h1 { font-size: 24px; margin-bottom: 16px; }
      p { line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${titulo}</h1>
      <p>${mensagem}</p>
    </main>
  </body>
</html>`;

const responder = (req, res, status, titulo, mensagem, payload = {}) => {
  if (req.method === 'GET') {
    res.status(status).send(renderMensagemHtml(titulo, mensagem));
  } else {
    res.status(status).json({ message: mensagem, titulo, ...payload });
  }
};

const extrairToken = req => {
  if (req.method === 'GET') {
    const token = typeof req.query.token === 'string' ? req.query.token : Array.isArray(req.query.token) ? req.query.token[0] : '';
    return (token || '').trim();
  }
  if (!req.body || typeof req.body !== 'object') {
    return '';
  }
  const token = req.body.token;
  return typeof token === 'string' ? token.trim() : '';
};

const tokenExpirado = usuario => {
  if (!usuario.confirmacao_token_expira_em) return false;
  const data = usuario.confirmacao_token_expira_em instanceof Date
    ? usuario.confirmacao_token_expira_em
    : new Date(usuario.confirmacao_token_expira_em);
  if (Number.isNaN(data.getTime())) return false;
  return data.getTime() < Date.now();
};

router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const novoStatus = normalizarStatus(req.body);

  if (typeof novoStatus !== 'string') {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    const estadoAtual = await pool.query('SELECT 1 FROM usuarios WHERE id = $1', [id]);

    if (estadoAtual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const novoVerificado = novoStatus === 'ativo';

    const result = await pool.query(
      `UPDATE usuarios
          SET status = $1,
              verificado = $2,
              email_confirmado = CASE WHEN $1 = 'ativo' THEN true ELSE email_confirmado END,
              status_atualizado_em = NOW(),
              hora_ativacao = CASE WHEN $1 = 'ativo' THEN NOW() ELSE hora_ativacao END
        WHERE id = $3
      RETURNING id, nome, email, perfil, verificado, hora_ativacao, status, email_confirmado, email_confirmado_em, status_atualizado_em`,
      [novoStatus, novoVerificado, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const usuario = formatarUsuario(result.rows[0]);

    res.json(usuario);
  } catch (err) {
    console.error('Erro ao atualizar status do usuário:', err);
    res.status(500).json({ error: 'Erro ao atualizar status do usuário' });
  }
});

async function confirmarEmail(req, res) {
  const token = extrairToken(req);

  if (!token) {
    return responder(req, res, 400, 'Token inválido', 'Token de confirmação não informado.');
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nome, email, email_confirmado, confirmacao_token_expira_em
         FROM usuarios
        WHERE confirmacao_token = $1`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return responder(req, res, 404, 'Token inválido', 'Não encontramos uma solicitação válida para este link.');
    }

    const usuario = resultado.rows[0];

    if (tokenExpirado(usuario)) {
      return responder(
        req,
        res,
        410,
        'Token expirado',
        'O link de confirmação expirou. Solicite um novo cadastro.'
      );
    }

    if (usuario.email_confirmado) {
      return responder(
        req,
        res,
        200,
        'E-mail já confirmado',
        'Você já havia confirmado este e-mail. Aguarde a aprovação do Sup Admin.'
      );
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET email_confirmado = true,
              email_confirmado_em = NOW(),
              status = 'aguardando_aprovacao',
              status_atualizado_em = NOW(),
              confirmacao_token = NULL,
              confirmacao_token_revogado_em = NOW()
        WHERE id = $1
      RETURNING id, nome, email, perfil, status, verificado, hora_ativacao, email_confirmado, email_confirmado_em, status_atualizado_em`,
      [usuario.id]
    );

    const usuarioAtualizado = atualizado.rows[0];

    try {
      await sendSupAdminReviewNotification({
        usuarioNome: usuarioAtualizado.nome,
        usuarioEmail: usuarioAtualizado.email,
        motivo: 'Usuário confirmou o e-mail.',
        acaoRecomendada: 'Acesse o painel e realize a aprovação do cadastro.'
      });
    } catch (err) {
      console.error('sendSupAdminReviewNotification error', err);
    }

    return responder(
      req,
      res,
      200,
      'Confirmação registrada',
      'Obrigado! Sua confirmação foi recebida e o Sup Admin foi notificado.',
      { usuario: formatarUsuario(usuarioAtualizado) }
    );
  } catch (err) {
    console.error('Erro ao confirmar e-mail do usuário:', err);
    return responder(
      req,
      res,
      500,
      'Erro interno',
      'Não foi possível confirmar seu e-mail. Tente novamente mais tarde.'
    );
  }
}

async function reportarEmailIncorreto(req, res) {
  const token = extrairToken(req);

  if (!token) {
    return responder(req, res, 400, 'Token inválido', 'Token de confirmação não informado.');
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nome, email, confirmacao_token_expira_em
         FROM usuarios
        WHERE confirmacao_token = $1`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return responder(req, res, 404, 'Token inválido', 'Não encontramos uma solicitação válida para este link.');
    }

    const usuario = resultado.rows[0];

    if (tokenExpirado(usuario)) {
      return responder(
        req,
        res,
        410,
        'Token expirado',
        'O link de confirmação expirou. Caso o cadastro tenha sido indevido, entre em contato com o suporte.'
      );
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET email_confirmado = false,
              email_confirmado_em = NULL,
              verificado = false,
              status = 'nao_confirmado',
              status_atualizado_em = NOW(),
              confirmacao_token = NULL,
              confirmacao_token_revogado_em = NOW()
        WHERE id = $1
      RETURNING id, nome, email, perfil, status, verificado, hora_ativacao, email_confirmado, email_confirmado_em, status_atualizado_em`,
      [usuario.id]
    );

    const usuarioAtualizado = atualizado.rows[0];

    try {
      await sendSupAdminReviewNotification({
        usuarioNome: usuarioAtualizado.nome,
        usuarioEmail: usuarioAtualizado.email,
        motivo: 'O destinatário informou que não reconhece o cadastro.',
        acaoRecomendada: 'Investigue o caso e, se necessário, bloqueie o acesso.'
      });
    } catch (err) {
      console.error('sendSupAdminReviewNotification error', err);
    }

    return responder(
      req,
      res,
      200,
      'Relato registrado',
      'Obrigado por nos avisar. Nossa equipe foi notificada e investigará o caso.',
      { usuario: formatarUsuario(usuarioAtualizado) }
    );
  } catch (err) {
    console.error('Erro ao reportar e-mail incorreto:', err);
    return responder(
      req,
      res,
      500,
      'Erro interno',
      'Não foi possível registrar o relato. Tente novamente mais tarde.'
    );
  }
}

router.get('/confirmar-email', confirmarEmail);
router.post('/confirmar-email', confirmarEmail);
router.get('/reportar-email-incorreto', reportarEmailIncorreto);
router.post('/reportar-email-incorreto', reportarEmailIncorreto);

router.post('/aprovar', async (req, res) => {
  const usuarioId = Number(req.body?.usuarioId);
  const supAdminEmail = typeof req.body?.supAdminEmail === 'string' ? req.body.supAdminEmail.trim() : '';
  const supAdminSenha = typeof req.body?.supAdminSenha === 'string' ? req.body.supAdminSenha : '';

  if (!usuarioId || !supAdminEmail || !supAdminSenha) {
    return res.status(400).json({ error: 'Dados insuficientes para aprovação.' });
  }

  try {
    const credenciais = await pool.query(
      `SELECT id, senha, perfil
         FROM usuarios
        WHERE lower(email) = lower($1)`,
      [supAdminEmail]
    );

    if (credenciais.rows.length === 0) {
      return res.status(403).json({ error: 'Credenciais inválidas.' });
    }

    const supAdmin = credenciais.rows[0];
    const perfil = (supAdmin.perfil || '').toLowerCase();
    if (!perfil.includes('sup admin')) {
      return res.status(403).json({ error: 'Apenas Sup Admin pode aprovar usuários.' });
    }

    const senhaValida = await bcrypt.compare(supAdminSenha, supAdmin.senha || '');
    if (!senhaValida) {
      return res.status(403).json({ error: 'Credenciais inválidas.' });
    }

    const atualizado = await pool.query(
      `UPDATE usuarios
          SET status = 'ativo',
              verificado = true,
              email_confirmado = true,
              email_confirmado_em = COALESCE(email_confirmado_em, NOW()),
              status_atualizado_em = NOW(),
              hora_ativacao = NOW(),
              confirmacao_token = NULL,
              confirmacao_token_revogado_em = NOW()
        WHERE id = $1
      RETURNING id, nome, email, perfil, status, verificado, hora_ativacao, email_confirmado, email_confirmado_em, status_atualizado_em`,
      [usuarioId]
    );

    if (atualizado.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const usuario = atualizado.rows[0];

    try {
      await sendUserActivationNotice({ to: usuario.email, nome: usuario.nome });
    } catch (err) {
      console.error('sendUserActivationNotice error', err);
    }

    res.json({ message: 'Usuário aprovado com sucesso.', usuario: formatarUsuario(usuario) });
  } catch (err) {
    console.error('Erro ao aprovar usuário:', err);
    res.status(500).json({ error: 'Erro ao aprovar usuário.' });
  }
});

function formatarUsuario(u) {
  const parseDate = valor => {
    if (!valor) return null;
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data;
  };

  const ultimoLogin = parseDate(u.ultimo_login_em);
  const ultimaAtividade = parseDate(u.ultima_atividade_em);
  const ultimaEntrada = parseDate(u.ultima_entrada || u.ultima_entrada_em || u.ultimo_login_em);
  const ultimaAlteracao = parseDate(u.ultima_alteracao) || ultimaAtividade;
  const ultimaSaida = parseDate(u.ultima_saida || u.ultima_saida_em);
  const horaAtivacao = parseDate(u.hora_ativacao);
  const ultimaAcaoLocal =
    u.local_ultima_alteracao || u.local_ultima_acao || u.local_ultima_atividade || null;
  const especificacaoUltimaAcao =
    u.especificacao_ultima_alteracao ||
    u.especificacao_ultima_acao ||
    u.ultima_acao_descricao ||
    u.ultima_alteracao_descricao ||
    u.ultima_acao ||
    null;

  let online;
  if (ultimaEntrada || ultimaSaida) {
    if (!ultimaSaida) {
      online = Boolean(ultimaEntrada);
    } else if (!ultimaEntrada) {
      online = false;
    } else {
      online = ultimaSaida.getTime() < ultimaEntrada.getTime();
    }
  } else {
    const ONLINE_LIMITE_MINUTOS = 5;
    online = ultimaAtividade
      ? Date.now() - ultimaAtividade.getTime() <= ONLINE_LIMITE_MINUTOS * 60 * 1000
      : false;
  }

  const serializar = data => (data ? data.toISOString() : null);

  const formatarDescricaoAlteracao = () => {
    const local = (ultimaAcaoLocal || '').trim();
    const especificacao = (especificacaoUltimaAcao || '').trim();
    if (local && especificacao) {
      return `Usuário alterou o módulo ${local}, mudando ${especificacao}`;
    }
    if (local) {
      return `Usuário alterou o módulo ${local}`;
    }
    if (especificacao) {
      return `Usuário alterou ${especificacao}`;
    }
    return '';
  };

  const ultimaAlteracaoDescricao = formatarDescricaoAlteracao();

  const statusRaw = typeof u.status === 'string' ? u.status.trim().toLowerCase() : '';
  const statusInterno = statusRaw || (u.verificado ? 'ativo' : 'nao_confirmado');
  const statusLabel = (() => {
    switch (statusInterno) {
      case 'ativo':
        return 'Ativo';
      case 'aguardando_aprovacao':
        return 'Aguardando aprovação';
      case 'nao_confirmado':
        return 'Não confirmado';
      default:
        return u.verificado ? 'Ativo' : 'Inativo';
    }
  })();

  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    status: statusLabel,
    statusInterno,
    emailConfirmado: Boolean(u.email_confirmado),
    emailConfirmadoEm: serializar(parseDate(u.email_confirmado_em)),
    statusAtualizadoEm: serializar(parseDate(u.status_atualizado_em)),
    online,
    ultimoLoginEm: serializar(ultimaEntrada || ultimoLogin),
    ultimaAtividadeEm: serializar(ultimaAtividade),
    ultimaAlteracaoEm: serializar(ultimaAlteracao),
    ultimaEntradaEm: serializar(ultimaEntrada),
    ultimaSaidaEm: serializar(ultimaSaida),
    horaAtivacaoEm: serializar(horaAtivacao),
    hora_ativacao: serializar(horaAtivacao),
    ultimaAlteracaoDescricao: ultimaAlteracaoDescricao || null,
    localUltimaAlteracao: ultimaAcaoLocal || null,
    especificacaoUltimaAlteracao: especificacaoUltimaAcao || null
  };
}

module.exports = router;
