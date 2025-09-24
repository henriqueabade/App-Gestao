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

    garantirColuna('ultima_alteracao', 'ultima_alteracao') ||
      garantirColuna('ultima_acao_em', 'ultima_alteracao') ||
      garantirColuna('ultima_alteracao_em', 'ultima_alteracao');

    garantirColuna('ultima_entrada', 'ultima_entrada') ||
      garantirColuna('ultima_entrada_em', 'ultima_entrada');
    garantirColuna('ultima_saida', 'ultima_saida') ||
      garantirColuna('ultima_saida_em', 'ultima_saida');

    garantirColuna('local_ultima_acao', 'local_ultima_acao') ||
      garantirColuna('local_ultima_alteracao', 'local_ultima_acao');

    garantirColuna('especificacao_ultima_acao', 'especificacao_ultima_acao') ||
      garantirColuna('especificacao_ultima_alteracao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_alteracao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao', 'especificacao_ultima_acao');

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
      const ultimaEntrada = parseDate(u.ultima_entrada || u.ultima_entrada_em || u.ultimo_login_em);
      const ultimaAlteracao = parseDate(u.ultima_alteracao) || ultimaAtividade;
      const ultimaSaida = parseDate(u.ultima_saida || u.ultima_saida_em);
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

      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        perfil: u.perfil,
        status: u.verificado ? 'Ativo' : 'Inativo',
        online,
        ultimoLoginEm: serializar(ultimaEntrada || ultimoLogin),
        ultimaAtividadeEm: serializar(ultimaAtividade),
        ultimaAlteracaoEm: serializar(ultimaAlteracao),
        ultimaEntradaEm: serializar(ultimaEntrada),
        ultimaSaidaEm: serializar(ultimaSaida),
        ultimaAlteracaoDescricao: ultimaAlteracaoDescricao || null,
        localUltimaAlteracao: ultimaAcaoLocal || null,
        especificacaoUltimaAlteracao: especificacaoUltimaAcao || null
      };
    });

    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

module.exports = router;
