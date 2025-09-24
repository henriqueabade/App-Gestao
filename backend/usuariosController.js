const express = require('express');
const pool = require('./db');

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

    garantirColuna('ultima_acao_em', 'ultima_acao_em') ||
      garantirColuna('ultima_alteracao_em', 'ultima_acao_em');

    garantirColuna('ultima_acao_descricao', 'ultima_acao_descricao') ||
      garantirColuna('ultima_alteracao_descricao', 'ultima_acao_descricao') ||
      garantirColuna('ultima_acao', 'ultima_acao_descricao');

    const query = `SELECT ${selecionar.join(', ')} FROM usuarios u ORDER BY u.nome`;
    const result = await pool.query(query);

    const usuarios = result.rows.map(u => {
      const parseDate = valor => {
        if (!valor) return null;
        const data = valor instanceof Date ? valor : new Date(valor);
        return Number.isNaN(data.getTime()) ? null : data;
      };

      const ultimoLogin = parseDate(u.ultimo_login_em);
      const ultimaAtividade = parseDate(u.ultima_atividade_em);
      const ultimaAcaoEm = parseDate(u.ultima_acao_em) || ultimaAtividade;
      const descricao = u.ultima_acao_descricao || null;

      const ONLINE_LIMITE_MINUTOS = 5;
      const online = ultimaAtividade
        ? Date.now() - ultimaAtividade.getTime() <= ONLINE_LIMITE_MINUTOS * 60 * 1000
        : false;

      const serializar = data => (data ? data.toISOString() : null);

      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        perfil: u.perfil,
        status: u.verificado ? 'Ativo' : 'Inativo',
        online,
        ultimoLoginEm: serializar(ultimoLogin),
        ultimaAtividadeEm: serializar(ultimaAtividade),
        ultimaAlteracaoEm: serializar(ultimaAcaoEm),
        ultimaAlteracaoDescricao: descricao
      };
    });

    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

module.exports = router;
