// Grava no módulo de destino o que sobreviveu à revisão.
//
// ---------------------------------------------------------------------------
// A GRAVAÇÃO PASSA PELO MÓDULO DE DESTINO, NÃO PELA API DIRETO
//
// Dar entrada em estoque não é um UPDATE em `materia_prima.quantidade`: é isso
// MAIS uma linha em `materia_prima_movimentacoes`, com saldo anterior e saldo
// posterior, e o arredondamento em 4 casas que impede a soma binária de comer
// centésimos a cada movimento. Tudo isso já existe em backend/materiaPrima.js.
//
// Reimplementar aqui criaria um segundo caminho para mexer no estoque — e o
// dia em que os dois divergissem, o razão pararia de fechar com o saldo sem
// que nada acusasse. Por isso este arquivo ORQUESTRA e delega.
//
// ---------------------------------------------------------------------------
// APLICAÇÃO É PARCIAL POR DESENHO
//
// Cada item é gravado por conta própria e guarda o próprio resultado. Um item
// que falha não desfaz os anteriores: não há transação entre chamadas HTTP à
// API remota (ver DEV-ONBOARDING.md), então "tudo ou nada" seria uma promessa
// que não dá para cumprir. Melhor gravar 18 de 20 e dizer quais 2 faltaram do
// que fingir atomicidade e deixar o usuário sem saber o que entrou.

const db = require('./db');
const materiaPrima = require('./materiaPrima');
const prospeccoes = require('./prospeccoesController');
const orcamentos = require('./orcamentosController');
const clientes = require('./clientesController');
const { obterEsquema, soDigitos } = require('./iaEsquemas');
const { normalizar } = require('./iaReconciliacao');

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

/**
 * Id do registro para onde o item vai.
 *
 * `Number.isFinite(Number(item.alvo_id))` NÃO basta: `Number(null)` e
 * `Number('')` são ZERO, e zero passa por finito. Um item sem destino escolhido
 * gravava no registro de id 0 — que não existe, mas a linha ia para o banco
 * apontando para lá. Id de verdade é inteiro POSITIVO.
 */
function idAlvo(item, oQue) {
  const bruto = item?.alvo_id;
  if (bruto === null || bruto === undefined || bruto === '') {
    throw erro(400, `Sem ${oQue} de destino`);
  }
  const id = Number(bruto);
  if (!Number.isInteger(id) || id <= 0) throw erro(400, `Destino inválido para ${oQue}`);
  return id;
}

// ---------------------------------------------------------------------------
// Taxonomia (categoria e unidade)
// ---------------------------------------------------------------------------

/**
 * Encaixa o valor lido na opção que já existe, ou devolve o valor como veio.
 *
 * "chapas", "CHAPAS" e "Chapas" são a mesma categoria. Sem este encaixe, cada
 * fornecedor com uma grafia diferente criaria uma entrada nova na lista, e o
 * filtro do módulo de Matéria-prima viraria uma lista de variações da mesma
 * palavra.
 */
function encaixar(valor, opcoes) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return null;
  const alvo = normalizar(bruto);
  const achado = (opcoes || []).find(o => normalizar(o) === alvo);
  return achado || bruto;
}

/**
 * Garante que categoria e unidade existam nas listas do módulo.
 *
 * Um insumo com categoria que não está na tabela `categoria` fica invisível no
 * filtro por categoria da tela de Matéria-prima — cadastrado, mas fora do
 * alcance de quem for procurá-lo por ali. Registrar a opção nova é o que
 * mantém o insumo alcançável; o encaixe acima é o que impede isso de virar
 * poluição.
 */
async function garantirTaxonomia({ categoria, unidade }, cache) {
  const notas = [];

  if (categoria && !cache.categorias.some(c => normalizar(c) === normalizar(categoria))) {
    try {
      await materiaPrima.adicionarCategoria(categoria);
      cache.categorias.push(categoria);
      notas.push(`categoria "${categoria}" cadastrada`);
    } catch (_) {
      // Falhar aqui não pode impedir o insumo de entrar: a categoria é
      // classificação, o saldo é o dado.
      notas.push(`não foi possível cadastrar a categoria "${categoria}"`);
    }
  }

  if (unidade && !cache.unidades.some(u => normalizar(u) === normalizar(unidade))) {
    try {
      await materiaPrima.adicionarUnidade(unidade);
      cache.unidades.push(unidade);
      notas.push(`unidade "${unidade}" cadastrada`);
    } catch (_) {
      notas.push(`não foi possível cadastrar a unidade "${unidade}"`);
    }
  }

  return notas;
}

// ---------------------------------------------------------------------------
// Matéria-prima
// ---------------------------------------------------------------------------

async function aplicarMateriaPrima(item, contexto) {
  const { cache, usuarioId, nota } = contexto;
  const dados = item.dados || {};

  const nome = String(dados.nome || '').trim();
  if (!nome) throw erro(400, 'Sem nome de insumo');

  // Ausência é checada ANTES da conversão: `Number(null)` e `Number('')` dão
  // ZERO, e uma quantidade que ninguém preencheu viraria uma entrada de zero
  // gravada em silêncio — com movimentação no razão e tudo.
  const quantidadeBruta = dados.quantidade;
  if (quantidadeBruta === null || quantidadeBruta === undefined || quantidadeBruta === '') {
    throw erro(400, 'Sem quantidade');
  }
  const quantidade = Number(quantidadeBruta);
  if (!Number.isFinite(quantidade) || quantidade < 0) throw erro(400, 'Quantidade inválida');

  const categoria = encaixar(dados.categoria, cache.categorias);
  const unidade = encaixar(dados.unidade, cache.unidades);
  const preco = dados.preco_unitario === null || dados.preco_unitario === undefined
    ? null : Number(dados.preco_unitario);

  const notas = await garantirTaxonomia({ categoria, unidade }, cache);

  // ---- cadastrar -----------------------------------------------------------
  if (item.acao === 'criar') {
    try {
      const criada = await materiaPrima.adicionarMateria({
        nome,
        quantidade,
        preco_unitario: preco ?? 0,
        categoria,
        unidade,
        infinito: false,
        processo: null,
        descricao: dados.descricao || null
      }, usuarioId);

      return {
        alvo_id: criada?.id ?? null,
        mensagem: ['Insumo cadastrado', ...notas].join(' · ')
      };
    } catch (e) {
      // A trava de duplicado do próprio módulo. Ela existe justamente para o
      // caso em que a reconciliação disse "novo" e o insumo já estava lá com o
      // nome escrito de outro jeito.
      if (e?.code === 'DUPLICADO') {
        throw erro(409, `Já existe um insumo chamado "${nome}". Mude a ação para "Dar entrada" e escolha o insumo existente.`);
      }
      throw e;
    }
  }

  // ---- dar entrada no que já existe ---------------------------------------
  if (item.acao === 'atualizar') {
    const alvo = idAlvo(item, 'insumo');

    // A ENTRADA é o passo irreversível: depois dela o saldo já mudou e não há
    // como desfazer por aqui. Se ela falhar, nada entrou e o item é erro de
    // verdade — pode ser reaplicado à vontade.
    await materiaPrima.registrarEntrada(alvo, quantidade, usuarioId, {
      origem: 'manual',
      nota
    });

    const feitos = [`Entrada de ${quantidade}`];
    const avisos = [];

    /**
     * Daqui para baixo, falha vira AVISO e não erro.
     *
     * O saldo já subiu. Marcar o item como "erro" convidaria o usuário a
     * corrigir e aplicar de novo — e a segunda aplicação somaria a quantidade
     * outra vez, dobrando o estoque por causa de um preço que não atualizou.
     * O que falta aqui é corrigível na tela de Matéria-prima; estoque em dobro
     * não é.
     */
    const tentar = async (o_que, fn) => {
      try { await fn(); return true; }
      catch (e) { avisos.push(`${o_que} não foi possível: ${String(e?.message || e).slice(0, 120)}`); return false; }
    };

    // Preço tem razão própria (`atualizarPreco` grava a movimentação de
    // preço e repassa o custo aos produtos que usam o insumo). Zero é preço
    // válido só na teoria: numa lista de compra é campo em branco lido como
    // número, e sobrescreveria o preço bom que já estava no cadastro.
    if (preco !== null && Number.isFinite(preco) && preco > 0) {
      const ok = await tentar('atualizar o preço',
        () => materiaPrima.atualizarPreco(alvo, preco, usuarioId));
      if (ok) feitos.push(`preço atualizado para ${preco}`);
    }

    // Unidade, categoria e observação são descritivas: não movimentam saldo e
    // por isso não passam pelo razão. Vão num PUT direto, com SÓ os campos que
    // vieram — mandar o payload inteiro sobrescreveria a quantidade que a
    // entrada acabou de somar.
    const descritivos = {};
    if (unidade) descritivos.unidade = unidade;
    if (categoria) descritivos.categoria = categoria;
    if (dados.descricao) descritivos.descricao = dados.descricao;
    if (Object.keys(descritivos).length) {
      const ok = await tentar('atualizar os dados do cadastro',
        () => db.put(`/materia_prima/${alvo}`, descritivos));
      if (ok) feitos.push('dados do cadastro atualizados');
    }

    return {
      alvo_id: alvo,
      mensagem: [feitos.join(', '), ...avisos, ...notas].join(' · ')
    };
  }

  throw erro(400, `Ação desconhecida: ${item.acao}`);
}

// ---------------------------------------------------------------------------
// Empresas (clientes e prospecções)
// ---------------------------------------------------------------------------

/**
 * Só o que o documento realmente trouxe.
 *
 * É a regra que impede a leitura de EMPOBRECER um cadastro. Um cartão de visita
 * tem nome e telefone; o cliente no sistema pode ter endereço completo, IE e
 * site preenchidos há anos. Mandar o payload inteiro, com null onde o cartão
 * não dizia nada, apagaria tudo isso — e ninguém perceberia até precisar do
 * endereço de entrega.
 */
function somenteVindos(dados, chaves) {
  const saida = {};
  for (const chave of chaves) {
    const valor = dados?.[chave];
    if (valor === null || valor === undefined) continue;
    if (typeof valor === 'string' && !valor.trim()) continue;
    saida[chave] = valor;
  }
  return saida;
}

const COLUNAS_EMPRESA = [
  'nome_fantasia', 'razao_social', 'cnpj', 'inscricao_estadual', 'site',
  'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro',
  'end_cidade', 'end_uf', 'end_cep'
];

/** O endereço plano da leitura na forma que `clientesController` espera. */
const enderecoDeCliente = d => ({
  rua: d.end_logradouro, numero: d.end_numero, complemento: d.end_complemento,
  bairro: d.end_bairro, cidade: d.end_cidade, estado: d.end_uf,
  pais: d.end_pais, cep: d.end_cep
});

const contatosDe = item => (Array.isArray(item?.dados?.contatos) ? item.dados.contatos : [])
  .filter(c => String(c?.nome || '').trim());

/**
 * Contatos que ainda NÃO estão no cadastro.
 *
 * Aplicar a mesma lista de cartões duas vezes, ou ler um documento que repete
 * gente já cadastrada, encheria a ficha de linhas iguais. Compara por e-mail
 * (identificador de fato) e, na falta dele, por nome.
 */
function contatosInexistentes(novos, atuais) {
  const porEmail = new Set((atuais || []).map(c => normalizar(c.email)).filter(Boolean));
  const porNome = new Set((atuais || []).map(c => normalizar(c.nome)).filter(Boolean));

  const saida = [];
  for (const c of novos) {
    const email = normalizar(c.email);
    const nome = normalizar(c.nome);
    if (email && porEmail.has(email)) continue;
    if (!email && nome && porNome.has(nome)) continue;
    saida.push(c);
    if (email) porEmail.add(email);
    if (nome) porNome.add(nome);
  }
  return saida;
}

async function aplicarClientes(item, contexto) {
  const { api } = contexto;
  const dados = item.dados || {};
  const nome = String(dados.nome_fantasia || '').trim();
  if (!nome) throw erro(400, 'Sem nome de empresa');

  const contatos = contatosDe(item);
  const notas = [];

  // ---- cadastrar -----------------------------------------------------------
  if (item.acao === 'criar') {
    // A trava de CNPJ repetido é do módulo de Clientes. Conferir antes devolve
    // uma mensagem que diz o que fazer, em vez de um 500 vindo do banco.
    if (dados.cnpj) {
      const existentes = await api.get('/api/clientes', { query: { cnpj: dados.cnpj } }).catch(() => []);
      if (Array.isArray(existentes) && existentes.length) {
        throw erro(409, `Já existe um cliente com o CNPJ ${dados.cnpj}. Mude a ação para "Atualizar" e escolha o cliente existente.`);
      }
    }

    const criado = await api.post('/api/clientes', clientes.buildPayload({
      ...dados,
      endereco_registro: enderecoDeCliente(dados)
    }));
    const clienteId = criado?.id ?? criado?.[0]?.id;
    if (!clienteId) throw erro(502, 'A API não devolveu o id do cliente criado');

    for (const c of contatos) {
      await api.post('/api/contatos_cliente', {
        id_cliente: clienteId,
        nome: c.nome, cargo: c.cargo, email: c.email,
        telefone_fixo: c.telefone_fixo, telefone_celular: c.telefone_celular
      });
    }

    return {
      alvo_id: clienteId,
      mensagem: [`Cliente cadastrado`, contatos.length ? `${contatos.length} contato(s)` : null, ...notas]
        .filter(Boolean).join(' · ')
    };
  }

  // ---- atualizar o que já existe ------------------------------------------
  if (item.acao === 'atualizar') {
    const alvo = idAlvo(item, 'cliente');

    const vindos = somenteVindos(dados, COLUNAS_EMPRESA);
    const feitos = [];

    if (Object.keys(vindos).length) {
      await api.put(`/api/clientes/${alvo}`, clientes.buildPayload({
        ...vindos,
        endereco_registro: enderecoDeCliente(vindos)
      }));
      feitos.push(`${Object.keys(vindos).length} campo(s) atualizado(s)`);
    }

    if (contatos.length) {
      const atuais = await api.get('/api/contatos_cliente', { query: { id_cliente: alvo } })
        .then(r => (Array.isArray(r) ? r : [])).catch(() => []);
      const faltantes = contatosInexistentes(contatos, atuais);
      for (const c of faltantes) {
        await api.post('/api/contatos_cliente', {
          id_cliente: alvo,
          nome: c.nome, cargo: c.cargo, email: c.email,
          telefone_fixo: c.telefone_fixo, telefone_celular: c.telefone_celular
        });
      }
      feitos.push(faltantes.length
        ? `${faltantes.length} contato(s) acrescentado(s)`
        : 'nenhum contato novo');
    }

    return { alvo_id: alvo, mensagem: feitos.join(', ') || 'Nada a mudar' };
  }

  throw erro(400, `Ação desconhecida: ${item.acao}`);
}

async function aplicarProspeccoes(item, contexto) {
  const { api, usuarioId } = contexto;
  const dados = item.dados || {};
  const nome = String(dados.nome_fantasia || '').trim();
  if (!nome) throw erro(400, 'Sem nome de empresa');

  const contatos = contatosDe(item);

  // ---- cadastrar -----------------------------------------------------------
  if (item.acao === 'criar') {
    const payload = prospeccoes.montarPayload(dados);
    prospeccoes.validarProspeccao(payload);
    payload.criado_por = usuarioId ?? null;

    // Índice único parcial no banco: uma empresa não pode estar em duas
    // prospecções ATIVAS. Conferir aqui devolve instrução em vez de 500.
    if (payload.cnpj) {
      const existentes = await api.get('/api/prospeccoes', { query: { cnpj: payload.cnpj } }).catch(() => []);
      if ((existentes || []).some(p => p.status === 'ativa')) {
        throw erro(409, `Já existe prospecção ativa para o CNPJ ${payload.cnpj}. Mude a ação para "Atualizar" e escolha a prospecção existente.`);
      }
    }

    const criada = await api.post('/api/prospeccoes', payload);
    const prospeccaoId = criada?.id ?? criada?.[0]?.id;
    if (!prospeccaoId) throw erro(502, 'A API não devolveu o id da prospecção criada');

    // A primeira pessoa da lista vira o contato principal. Alguém precisa ser,
    // e a ordem do documento é a única pista que existe — o revisor troca pela
    // tela de Prospecções se não for.
    const comPrincipal = prospeccoes.normalizarPrincipais(
      contatos.map((c, i) => ({ ...c, principal: i === 0 }))
    );
    for (const c of comPrincipal) {
      await api.post('/api/prospeccao_contatos', prospeccoes.montarPayloadContato(c, prospeccaoId));
    }

    // O histórico da prospecção é a resposta para "de onde veio isto?". Uma
    // prospecção criada pela IA sem linha nenhuma no histórico apareceria no
    // funil sem origem.
    await prospeccoes.registrarHistorico(api, prospeccaoId, [
      {
        tipo: 'criacao', acao: 'criou', entidade: 'Prospecção',
        valor_novo: payload.nome_fantasia,
        observacao: contexto.nota,
        detalhe: payload
      },
      { tipo: 'etapa', acao: 'criou', entidade: 'Etapa do funil', campo: 'etapa', valor_novo: payload.etapa },
      ...comPrincipal.map(c => ({
        tipo: 'contato', acao: 'criou', entidade: prospeccoes.rotuloContato(c), detalhe: c
      }))
    ], usuarioId);

    return {
      alvo_id: prospeccaoId,
      mensagem: ['Prospecção cadastrada', contatos.length ? `${contatos.length} contato(s)` : null]
        .filter(Boolean).join(' · ')
    };
  }

  // ---- atualizar o que já existe ------------------------------------------
  if (item.acao === 'atualizar') {
    const alvo = idAlvo(item, 'prospecção');

    const vindos = somenteVindos(dados, [...COLUNAS_EMPRESA, 'segmento']);
    const feitos = [];

    if (Object.keys(vindos).length) {
      // `montarPayload` só inclui o que foi passado, então a etapa da
      // prospecção não é mexida — mover no funil é decisão de quem vende, não
      // de quem leu o documento.
      const payload = prospeccoes.montarPayload(vindos);
      delete payload.etapa;
      delete payload.probabilidade;
      await api.put(`/api/prospeccoes/${alvo}`, payload);
      feitos.push(`${Object.keys(vindos).length} campo(s) atualizado(s)`);
    }

    if (contatos.length) {
      const atuais = await api.get('/api/prospeccao_contatos', { query: { prospeccao_id: alvo } })
        .then(r => (Array.isArray(r) ? r : [])).catch(() => []);
      const faltantes = contatosInexistentes(contatos, atuais);
      // `principal` fica FALSE em todos: a prospecção já tem o dela, e o
      // índice único parcial do banco recusaria um segundo.
      for (const c of faltantes) {
        await api.post('/api/prospeccao_contatos',
          prospeccoes.montarPayloadContato({ ...c, principal: false }, alvo));
      }
      feitos.push(faltantes.length
        ? `${faltantes.length} contato(s) acrescentado(s)`
        : 'nenhum contato novo');
    }

    await prospeccoes.registrarHistorico(api, alvo, [{
      tipo: 'edicao', acao: 'editou', entidade: 'Prospecção',
      observacao: contexto.nota, detalhe: vindos
    }], usuarioId);

    return { alvo_id: alvo, mensagem: feitos.join(', ') || 'Nada a mudar' };
  }

  throw erro(400, `Ação desconhecida: ${item.acao}`);
}

// ---------------------------------------------------------------------------
// Insumos de produto (a ficha técnica)
// ---------------------------------------------------------------------------

/**
 * Preenche a ficha de insumos de um produto que JÁ EXISTE.
 *
 * ---------------------------------------------------------------------------
 * NUNCA REMOVE INSUMO
 *
 * A ficha de um produto é a receita dele. Uma ficha técnica em PDF pode ser
 * parcial — só a parte de marcenaria, só o que mudou — e substituir a receita
 * inteira por ela apagaria em silêncio os insumos que o documento não citou. O
 * produto passaria a custar menos do que custa, e o erro só apareceria no
 * fechamento. Por isso: acrescenta o que falta, corrige a quantidade do que já
 * está, e deixa o resto em paz.
 *
 * ---------------------------------------------------------------------------
 * O INSUMO TAMBÉM PRECISA EXISTIR
 *
 * Um nome que não casa com nenhuma matéria-prima NÃO vira insumo novo: o
 * cadastro de insumo tem preço, unidade e saldo, e inventar isso a partir de
 * uma ficha técnica encheria o estoque de linhas com preço zero. A linha é
 * pulada com o nome escrito no aviso, para o revisor cadastrar pelo caminho
 * certo (o destino Matéria-prima) e aplicar de novo.
 */
async function aplicarProdutoInsumos(item, contexto) {
  const { api, cache } = contexto;
  const dados = item.dados || {};

  if (item.acao === 'criar') {
    throw erro(400,
      'A ficha técnica não tem preço nem coleção para cadastrar um produto. '
      + 'Escolha o produto existente na coluna "O que fazer".');
  }
  if (item.acao !== 'atualizar') throw erro(400, `Ação desconhecida: ${item.acao}`);

  const produtoId = idAlvo(item, 'produto');

  const linhas = (Array.isArray(dados.insumos) ? dados.insumos : [])
    .filter(i => String(i?.nome || '').trim());
  if (!linhas.length) throw erro(400, 'Nenhum insumo nesta linha');

  // O catálogo de insumos vem UMA vez por lote: uma consulta por linha seriam
  // dezenas de requisições para uma tabela que não muda no meio da aplicação.
  if (!cache.insumosPorNome) {
    const materias = await api.get('/api/materia_prima')
      .then(r => (Array.isArray(r) ? r : [])).catch(() => []);
    cache.insumosPorNome = new Map();
    for (const m of materias) {
      const n = normalizar(m?.nome);
      if (n && !cache.insumosPorNome.has(n)) cache.insumosPorNome.set(n, m);
    }
  }

  const atuais = await api.get('/api/produtos_insumos', { query: { produto_id: produtoId } })
    .then(r => (Array.isArray(r) ? r : [])).catch(() => []);
  const atuaisPorInsumo = new Map(atuais.map(l => [Number(l.insumo_id), l]));

  const acrescentados = [];
  const corrigidos = [];
  const semCadastro = [];
  const tocados = new Set();

  for (const linha of linhas) {
    const insumo = cache.insumosPorNome.get(normalizar(linha.nome));
    if (!insumo) { semCadastro.push(String(linha.nome).trim()); continue; }

    const quantidade = Number(linha.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      semCadastro.push(`${linha.nome} (quantidade inválida)`);
      continue;
    }

    const existente = atuaisPorInsumo.get(Number(insumo.id));
    if (existente) {
      // Mesma quantidade não gera escrita: um PUT que não muda nada só suja o
      // log e gasta requisição.
      if (Number(existente.quantidade) !== quantidade) {
        await api.put(`/api/produtos_insumos/${existente.id}`, { quantidade });
        corrigidos.push(insumo.nome);
        tocados.add(Number(insumo.id));
      }
      continue;
    }

    await api.post('/api/produtos_insumos', {
      produto_id: produtoId,
      insumo_id: insumo.id,
      quantidade
    });
    acrescentados.push(insumo.nome);
    tocados.add(Number(insumo.id));
  }

  if (!acrescentados.length && !corrigidos.length && semCadastro.length) {
    throw erro(400, `Nenhum insumo desta linha existe no estoque: ${semCadastro.slice(0, 5).join(', ')}`);
  }

  // Mudar a receita muda o custo. O recálculo é o do próprio módulo de
  // Matéria-prima — a fórmula tem mão de obra, markup, comissão e imposto, e
  // reescrevê-la aqui criaria um segundo preço para o mesmo produto.
  const avisos = [];
  for (const insumoId of tocados) {
    try { await materiaPrima.atualizarProdutosComInsumo(insumoId); }
    catch (e) {
      avisos.push('o preço do produto não foi recalculado');
      break;
    }
  }

  const feitos = [];
  if (acrescentados.length) feitos.push(`${acrescentados.length} insumo(s) acrescentado(s)`);
  if (corrigidos.length) feitos.push(`${corrigidos.length} quantidade(s) corrigida(s)`);
  if (!feitos.length) feitos.push('a ficha já estava assim');
  if (semCadastro.length) {
    feitos.push(`${semCadastro.length} não existe(m) no estoque: ${semCadastro.slice(0, 3).join(', ')}`);
  }

  return { alvo_id: produtoId, mensagem: [...feitos, ...avisos].join(' · ') };
}

// ---------------------------------------------------------------------------
// Orçamentos
// ---------------------------------------------------------------------------

/**
 * Cria um orçamento PENDENTE para o cliente escolhido.
 *
 * ---------------------------------------------------------------------------
 * OU ENTRA INTEIRO, OU NÃO ENTRA
 *
 * Diferente da ficha técnica, aqui um item que não casou NÃO é pulado. Uma
 * receita incompleta continua utilizável; um orçamento incompleto é um PREÇO
 * ERRADO — e ele parece completo, sai da tela com um número e vai para o
 * cliente. Se algum produto da lista não existe no catálogo, nada é gravado e a
 * mensagem diz quais faltaram. Como nada entrou, aplicar de novo depois de
 * corrigir é seguro.
 *
 * ---------------------------------------------------------------------------
 * CLIENTE OU PROSPECÇÃO
 *
 * O alvo pode ser dos dois tipos, e `alvo_tabela` diz qual. Isso não é detalhe
 * de gravação: um orçamento de prospecção sai na série OCRP e aparece na ficha
 * da prospecção; um de cliente sai como ORC. Mandar um id de prospecção no
 * campo `cliente_id` prenderia o orçamento ao CLIENTE de mesmo número — outra
 * empresa, escolhida por acidente.
 *
 * ---------------------------------------------------------------------------
 * NASCE PENDENTE
 *
 * `situacao: 'Pendente'`, sempre. Aprovar um orçamento dispara a conversão em
 * pedido, que abate estoque — decisão de gente, não de leitura de documento.
 */
async function aplicarOrcamentos(item, contexto) {
  const { api, cache, usuarioId } = contexto;
  const dados = item.dados || {};

  if (item.acao !== 'criar') {
    throw erro(400, 'A leitura só cria orçamento novo; ela não mexe em orçamento que já existe.');
  }

  const alvoId = idAlvo(item, 'cliente ou prospecção');
  const naProspeccao = item.alvo_tabela === 'prospeccoes';

  // A prospecção precisa existir: FK inválida só estouraria depois de já ter
  // gravado o orçamento, deixando itens pendurados em nada.
  if (naProspeccao) {
    const p = await api.get(`/api/prospeccoes/${alvoId}`).catch(() => null);
    if (!p?.id) throw erro(400, 'A prospecção escolhida não existe mais.');
  }

  const linhas = (Array.isArray(dados.itens) ? dados.itens : [])
    .filter(i => String(i?.nome || '').trim());
  if (!linhas.length) throw erro(400, 'Nenhum item neste orçamento');

  // Catálogo UMA vez por lote. Dois índices porque o documento tanto pode
  // trazer o código quanto só o nome.
  if (!cache.produtos) {
    const lista = await api.get('/api/produtos')
      .then(r => (Array.isArray(r) ? r : [])).catch(() => []);
    cache.produtos = { porNome: new Map(), porCodigo: new Map() };
    for (const p of lista) {
      const n = normalizar(p?.nome);
      const c = normalizar(p?.codigo);
      if (n && !cache.produtos.porNome.has(n)) cache.produtos.porNome.set(n, p);
      if (c && !cache.produtos.porCodigo.has(c)) cache.produtos.porCodigo.set(c, p);
    }
  }

  const itens = [];
  const semCadastro = [];
  const semPreco = [];

  for (const linha of linhas) {
    const produto = cache.produtos.porCodigo.get(normalizar(linha.codigo))
      || cache.produtos.porNome.get(normalizar(linha.nome));
    if (!produto) { semCadastro.push(String(linha.nome).trim()); continue; }

    const quantidade = Number(linha.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      semCadastro.push(`${linha.nome} (quantidade inválida)`);
      continue;
    }

    // Sem preço no documento, vale o de tabela. É o comportamento útil: um
    // pedido de compra costuma listar o que se quer, não quanto custa.
    let valorUnitario = Number(linha.valor_unitario);
    if (!Number.isFinite(valorUnitario) || valorUnitario <= 0) {
      valorUnitario = Number(produto.preco_venda) || 0;
      semPreco.push(produto.nome);
    }

    itens.push({
      produto_id: produto.id,
      codigo: produto.codigo || null,
      nome: produto.nome,
      ncm: produto.ncm || null,
      quantidade,
      valor_unitario: valorUnitario,
      valor_unitario_desc: valorUnitario,
      desconto_total: 0,
      valor_desc: 0,
      valor_total: valorUnitario * quantidade
    });
  }

  // Ver "OU ENTRA INTEIRO, OU NÃO ENTRA" acima.
  if (semCadastro.length) {
    throw erro(400,
      `${semCadastro.length} produto(s) não estão no catálogo: ${semCadastro.slice(0, 5).join(', ')}. `
      + 'Nada foi gravado — cadastre-os e aplique de novo.');
  }

  const valorFinal = itens.reduce((soma, i) => soma + i.valor_total, 0);

  // `dono` guarda o NOME do usuário (é o que o select do módulo grava). Sem
  // ele o orçamento fica sem responsável na tela.
  if (cache.nomeDoUsuario === undefined) {
    cache.nomeDoUsuario = usuarioId
      ? await api.get(`/api/usuarios/${usuarioId}`).then(u => u?.nome || null).catch(() => null)
      : null;
  }

  const { created, numero } = await orcamentos.criarOrcamentoComNumero(api, {
    // `prospeccao_id` também é o que faz `criarOrcamentoComNumero` escolher a
    // série OCRP em vez de ORC.
    cliente_id: naProspeccao ? null : alvoId,
    prospeccao_id: naProspeccao ? alvoId : null,
    situacao: 'Pendente',
    data_emissao: new Date().toISOString(),
    validade: dados.validade || null,
    prazo: dados.prazo || null,
    forma_pagamento: dados.forma_pagamento || null,
    observacoes: [dados.observacoes, contexto.nota].filter(Boolean).join(' · ').slice(0, 500),
    desconto_pagamento: 0,
    desconto_especial: 0,
    desconto_total: 0,
    valor_final: valorFinal,
    dono: cache.nomeDoUsuario
  });

  const orcamentoId = created?.id ?? created?.[0]?.id;
  if (!orcamentoId) throw erro(502, 'A API não devolveu o id do orçamento criado');

  for (const linha of itens) {
    await api.post('/api/orcamentos_itens', { ...linha, orcamento_id: orcamentoId });
  }

  const feitos = [
    `Orçamento ${numero} criado (${itens.length} itens) para ${naProspeccao ? 'a prospecção' : 'o cliente'}`
  ];
  if (semPreco.length) {
    feitos.push(`${semPreco.length} item(ns) com preço de tabela: ${semPreco.slice(0, 3).join(', ')}`);
  }

  return { alvo_id: orcamentoId, mensagem: feitos.join(' · ') };
}

const APLICADORES = {
  materia_prima: aplicarMateriaPrima,
  clientes: aplicarClientes,
  produto_insumos: aplicarProdutoInsumos,
  orcamentos: aplicarOrcamentos,
  prospeccoes: aplicarProspeccoes
};

/** Destinos que já sabem gravar. Os demais chegam nas próximas etapas. */
const DESTINOS_APLICAVEIS = Object.keys(APLICADORES);

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

/**
 * Aplica os itens de uma leitura e devolve o resultado de cada um.
 *
 * Roda dentro de `db.runWithToken` para que as gravações saiam com o token de
 * QUEM PEDIU, e não com o token de serviço do aplicativo — senão o histórico
 * de estoque registraria "o sistema" onde deveria registrar a pessoa.
 *
 * Em série de propósito: dar entrada em dois itens ao mesmo tempo é onde
 * apareceriam as corridas de saldo, e o ganho de tempo não vale o risco numa
 * operação que mexe em estoque.
 */
async function aplicar({ destino, itens, usuarioId, token, extracaoId, titulo, api }) {
  const esquema = obterEsquema(destino);
  const aplicador = APLICADORES[destino];
  if (!esquema || !aplicador) {
    throw erro(400, `Ainda não é possível aplicar em "${destino}".`);
  }

  const executar = async () => {
    // As listas de categoria e unidade são lidas UMA vez e mantidas em memória
    // durante o lote: relê-las a cada item seriam 2N requisições para uma
    // resposta que quase nunca muda no meio da aplicação.
    const cache = { categorias: [], unidades: [] };
    if (destino === 'materia_prima') {
      const [categorias, unidades] = await Promise.all([
        materiaPrima.listarCategorias().catch(() => []),
        materiaPrima.listarUnidades().catch(() => [])
      ]);
      cache.categorias = categorias;
      cache.unidades = unidades;
    }

    const nota = `Leitura de IA #${extracaoId}${titulo ? ` — ${titulo}` : ''}`.slice(0, 200);
    const resultados = [];

    for (const item of itens) {
      if (item.acao === 'ignorar') {
        resultados.push({ id: item.id, status: 'ignorado', alvo_id: null, mensagem: 'Descartado na revisão' });
        continue;
      }
      // Reaplicar o que já entrou duplicaria estoque. A guarda fica aqui e
      // não só na rota porque é aqui que a gravação acontece.
      if (item.status === 'aplicado') {
        resultados.push({ id: item.id, status: 'aplicado', alvo_id: item.alvo_id ?? null, mensagem: item.mensagem || 'Já estava aplicado' });
        continue;
      }

      try {
        const r = await aplicador(item, { cache, usuarioId, nota, api });
        resultados.push({ id: item.id, status: 'aplicado', alvo_id: r.alvo_id, mensagem: r.mensagem });
      } catch (e) {
        resultados.push({
          id: item.id,
          status: 'erro',
          alvo_id: item.alvo_id ?? null,
          mensagem: String(e?.message || 'Falha ao gravar').slice(0, 500)
        });
      }
    }

    return resultados;
  };

  return token ? db.runWithToken(token, executar) : executar();
}

module.exports = {
  APLICADORES,
  DESTINOS_APLICAVEIS,
  COLUNAS_EMPRESA,
  idAlvo,
  encaixar,
  garantirTaxonomia,
  somenteVindos,
  contatosInexistentes,
  aplicarMateriaPrima,
  aplicarClientes,
  aplicarProspeccoes,
  aplicarProdutoInsumos,
  aplicarOrcamentos,
  aplicar
};
