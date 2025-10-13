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

    garantirColuna('hora_ativacao', 'hora_ativacao');

    garantirColuna('local_ultima_acao', 'local_ultima_acao') ||
      garantirColuna('local_ultima_alteracao', 'local_ultima_acao');

    garantirColuna('especificacao_ultima_acao', 'especificacao_ultima_acao') ||
      garantirColuna('especificacao_ultima_alteracao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_alteracao_descricao', 'especificacao_ultima_acao') ||
      garantirColuna('ultima_acao', 'especificacao_ultima_acao');

    const garantirPrimeiraColuna = (alias, candidatos) => {
      for (const nome of candidatos) {
        if (garantirColuna(nome, alias)) {
          return alias;
        }
      }
      return null;
    };

    const statusTextoAlias = garantirPrimeiraColuna('status_texto', [
      'status',
      'status_usuario',
      'status_atual',
      'status_usuario_atual',
      'status_conta',
      'status_registro',
      'status_texto',
      'situacao',
      'situacao_usuario',
      'situacao_atual',
      'situacao_cadastro',
      'situacao_texto',
      'situacao_registro',
      'estado',
      'estado_usuario'
    ]);

    const aguardandoAlias = garantirPrimeiraColuna('aguardando_flag', [
      'aguardando',
      'aguardando_ativacao',
      'aguardando_confirmacao',
      'pendente',
      'pendente_validacao',
      'pendente_confirmacao'
    ]);

    const ativoAlias = garantirPrimeiraColuna('ativo_flag', [
      'ativo',
      'esta_ativo',
      'is_ativo',
      'ativo_flag',
      'habilitado',
      'enabled'
    ]);

    const inativoAlias = garantirPrimeiraColuna('inativo_flag', [
      'inativo',
      'esta_inativo',
      'is_inativo',
      'inativo_flag',
      'desativado',
      'bloqueado',
      'disabled'
    ]);

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

  if (typeof body.verificado === 'boolean') {
    return body.verificado;
  }

  if (typeof body.ativo === 'boolean') {
    return body.ativo;
  }

  if (typeof body.status === 'string') {
    const valor = body.status.trim().toLowerCase();
    if (valor === 'ativo') return true;
    if (valor === 'inativo') return false;
  }

  return undefined;
};

router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const novoStatus = normalizarStatus(req.body);

  if (typeof novoStatus !== 'boolean') {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  try {
    const estadoAtual = await pool.query('SELECT verificado FROM usuarios WHERE id = $1', [id]);

    if (estadoAtual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const verificadoAtual = estadoAtual.rows[0].verificado;
    const mudouStatus = verificadoAtual === null ? true : verificadoAtual !== novoStatus;

    let result;
    if (mudouStatus) {
      result = await pool.query(
        `UPDATE usuarios
            SET verificado = $1,
                hora_ativacao = NOW()
          WHERE id = $2
        RETURNING id, nome, email, perfil, verificado, hora_ativacao`,
        [novoStatus, id]
      );
    } else {
      result = await pool.query(
        `UPDATE usuarios
            SET verificado = $1
          WHERE id = $2
        RETURNING id, nome, email, perfil, verificado, hora_ativacao`,
        [novoStatus, id]
      );
    }

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

      const parseBoolean = valor => {
        if (valor === null || valor === undefined) return null;
        if (typeof valor === 'boolean') return valor;
        if (typeof valor === 'number') return valor !== 0;
        const texto = String(valor).trim().toLowerCase();
        if (!texto) return null;
        if (['1', 'true', 't', 'y', 'yes', 'sim', 's', 'ativo', 'active', 'habilitado', 'enabled'].includes(texto)) {
          return true;
        }
        if (
          [
            '0',
            'false',
            'f',
            'n',
            'no',
            'nao',
            'não',
            'inativo',
            'inactive',
            'desativado',
            'bloqueado',
            'disabled'
          ].includes(texto)
        ) {
          return false;
        }
        return null;
      };

      const formatarStatus = valor => {
        if (valor === null || valor === undefined) return '';
        if (typeof valor === 'boolean') {
          return valor ? 'Ativo' : 'Inativo';
        }
        if (typeof valor === 'number') {
          if (valor === 1) return 'Ativo';
          if (valor === 0) return 'Inativo';
        }
        const textoOriginal = String(valor).trim();
        if (!textoOriginal) return '';
        const texto = textoOriginal.toLowerCase();
        if (['1', 'true', 't', 'y', 'yes', 'sim', 's', 'ativo', 'active', 'habilitado', 'enabled'].includes(texto)) {
          return 'Ativo';
        }
        if (
          [
            '0',
            'false',
            'f',
            'n',
            'no',
            'nao',
            'não',
            'inativo',
            'inactive',
            'desativado',
            'bloqueado',
            'disabled'
          ].includes(texto)
        ) {
          return 'Inativo';
        }
        if (texto.includes('aguard') || texto.includes('pend')) {
          return 'Aguardando';
        }
        if (texto.includes('inativ') || texto.includes('desativ') || texto.includes('bloque')) {
          return 'Inativo';
        }
        if (texto.includes('ativo') || texto.includes('habilit') || texto.includes('liberado')) {
          return 'Ativo';
        }
        return textoOriginal
          .toLowerCase()
          .split(/\s+/)
          .map(parte => (parte ? parte.charAt(0).toUpperCase() + parte.slice(1) : ''))
          .join(' ');
      };

      const aguardando = aguardandoAlias ? parseBoolean(u[aguardandoAlias]) : null;
      const ativo = ativoAlias ? parseBoolean(u[ativoAlias]) : null;
      const inativo = inativoAlias ? parseBoolean(u[inativoAlias]) : null;

      const candidatosStatus = [];
      if (statusTextoAlias && u[statusTextoAlias] !== undefined) {
        candidatosStatus.push(formatarStatus(u[statusTextoAlias]));
      }
      if (aguardando === true) {
        candidatosStatus.push('Aguardando');
      }
      if (ativo !== null) {
        candidatosStatus.push(ativo ? 'Ativo' : 'Inativo');
      }
      if (inativo !== null) {
        candidatosStatus.push(inativo ? 'Inativo' : 'Ativo');
      }
      candidatosStatus.push(u.verificado ? 'Ativo' : 'Inativo');

      const status = candidatosStatus.find(valor => typeof valor === 'string' && valor.trim().length > 0) || 'Inativo';

      return {
        id: u.id,
        nome: u.nome,
        email: u.email,
        perfil: u.perfil,
        status,
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
