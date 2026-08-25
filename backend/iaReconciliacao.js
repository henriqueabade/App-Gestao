// Cada item extraído vira uma decisão: CADASTRAR, ATUALIZAR o que já existe,
// ou IGNORAR.
//
// É o passo entre "a IA leu" e "o sistema gravou", e o que evita o estrago
// mais caro do módulo: cadastrar de novo um insumo que já existe. O estoque
// passa a ter duas linhas do mesmo MDF, os produtos apontam para uma delas, e
// o saldo real fica repartido entre as duas sem ninguém perceber.
//
// ---------------------------------------------------------------------------
// A DECISÃO É SUGESTÃO, NÃO SENTENÇA
//
// Nada aqui grava coisa alguma. Cada item sai com uma ação proposta e, quando
// há dúvida, com o motivo escrito ao lado. Quem decide é quem revisa — e é por
// isso que o casamento POR APROXIMAÇÃO nunca escolhe sozinho: ele só levanta a
// mão. Juntar "MDF 15mm Branco" com "MDF 15mm Branco TX" automaticamente
// misturaria dois insumos diferentes, e o erro só apareceria no inventário.

const { obterEsquema } = require('./iaEsquemas');

// ---------------------------------------------------------------------------
// Comparação de nomes
// ---------------------------------------------------------------------------

/** Caixa, acento e espaço repetido não distinguem insumo. */
function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Só letras e dígitos. Serve para reconhecer que "MDF 15 mm" e "MDF-15mm" são
 * a mesma coisa escrita por dois fornecedores diferentes.
 */
const compactar = valor => normalizar(valor).replace(/[^a-z0-9]/g, '');

/** Palavras com 2+ caracteres, para medir o quanto dois nomes se parecem. */
function palavras(valor) {
  return new Set(normalizar(valor).split(' ').filter(p => p.length >= 2));
}

/**
 * Semelhança entre dois nomes, de 0 a 1 (Jaccard sobre as palavras).
 *
 * Escolhido por ser explicável: "5 das 7 palavras batem" é algo que dá para
 * conferir a olho na tela. Uma distância de edição daria um número melhor e
 * uma explicação pior — e aqui o número não decide nada sozinho, só chama
 * atenção de quem revisa.
 */
function semelhanca(a, b) {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns += 1;
  return comuns / (pa.size + pb.size - comuns);
}

/** A partir daqui vale avisar; abaixo disso é ruído. */
const LIMIAR_PARECIDO = 0.6;

// ---------------------------------------------------------------------------
// Reconciliação
// ---------------------------------------------------------------------------

/**
 * Decide a ação de cada item contra o que já existe na tabela de destino.
 *
 * `existentes` é a tabela inteira, trazida de uma vez e casada em memória: a
 * API remota não filtra por lista de valores (ver DEV-ONBOARDING.md, §3), e uma
 * requisição por item seria uma tempestade de chamadas para uma lista de 200
 * linhas.
 *
 * As chaves são tentadas EM ORDEM DE FORÇA. Para empresa isso é o que separa
 * um casamento seguro de um palpite: CNPJ igual é a mesma empresa, ponto;
 * nome fantasia igual é indício, porque "Marcenaria Serrana" e "Marcenaria
 * Serrana Ltda" tanto podem ser a mesma quanto duas.
 *
 * Devolve os itens com `acao`, `alvo_id`, `confianca` e `mensagem`.
 */
function reconciliar({ destino, itens, existentes }) {
  const esquema = obterEsquema(destino);
  if (!esquema) return itens.map(i => ({ ...i, acao: 'criar', alvo_id: null, confianca: null }));

  const chaves = esquema.chavesDeCasamento || [];
  const linhas = Array.isArray(existentes) ? existentes : [];

  /**
   * De qual tabela veio o registro casado.
   *
   * O orçamento procura em duas (clientes e prospecções), e é isso que decide
   * a série do número — ORC ou OCRP. Quem monta `existentes` carimba `_tabela`
   * em cada linha; nos destinos de tabela única não há o que carimbar.
   */
  const tabelaDa = linha => linha?._tabela || esquema.tabelaAlvo;
  const exibicao = esquema.campoDeExibicao || chaves[0]?.campo;

  /**
   * O que propor quando o alvo é encontrado.
   *
   * Quase sempre é "atualizar" — casou com um registro, mexe nele. No orçamento
   * é "criar": o alvo é o CLIENTE, e o que se cria é um orçamento novo pendurado
   * nele. Ver "AÇÕES OFERECIDAS" em iaEsquemas.js.
   */
  const acaoAoCasar = esquema.acaoAoCasar || 'atualizar';

  /** Como o registro aparece nas mensagens. */
  const rotularAlvo = linha => String(linha?.[exibicao] ?? `#${linha?.id}`);

  /**
   * Índices por chave. Dois por chave: um exato e um "sem pontuação" — o
   * segundo reconhece a mesma coisa escrita de outro jeito ("MDF 15 mm" e
   * "MDF-15mm") sem deixar de ser um casamento determinístico.
   *
   * Para chave com `normalizar` próprio (CNPJ, que vira só dígitos) os dois
   * índices coincidem, e é isso que se quer: pontuação de CNPJ não distingue.
   */
  const indices = chaves.map(chave => {
    const limpar = chave.normalizar || normalizar;
    // O item e a tabela podem chamar a mesma coisa por nomes diferentes: no
    // orçamento, o campo lido é "cliente" e a coluna é `nome_fantasia`.
    const coluna = chave.colunaAlvo || chave.campo;
    const exato = new Map();
    const compacto = new Map();
    for (const linha of linhas) {
      const bruto = linha?.[coluna];
      if (!bruto) continue;
      const n = limpar(bruto);
      const c = chave.normalizar ? n : compactar(bruto);
      if (n && !exato.has(n)) exato.set(n, linha);
      if (c && !compacto.has(c)) compacto.set(c, linha);
    }
    return { chave, coluna, limpar, exato, compacto };
  });

  /** Chaves já vistas NESTA leitura, para pegar repetição dentro do lote. */
  const vistosNoLote = new Map();

  return itens.map(item => {
    const ressalvas = item.mensagem ? [item.mensagem] : [];

    const decidir = extra => ({
      ...item,
      ...extra,
      mensagem: [...ressalvas, ...(extra.notas || [])].filter(Boolean).join(' · ') || null,
      notas: undefined
    });

    // Nenhuma das chaves veio preenchida: não há como comparar com nada.
    const preenchidas = indices.filter(i => item?.dados?.[i.chave.campo]);
    if (!preenchidas.length) {
      return decidir({
        acao: 'ignorar', alvo_id: null, alvo_tabela: null, confianca: 0,
        notas: [`Sem ${chaves.map(c => c.rotulo).join(' nem ')} para comparar`]
      });
    }

    // 1) Repetido dentro da própria leitura, por qualquer uma das chaves.
    for (const { chave, limpar } of preenchidas) {
      const marca = `${chave.campo}:${limpar(item.dados[chave.campo])}`;
      const jaVisto = vistosNoLote.get(marca);
      if (jaVisto !== undefined) {
        return decidir({
          acao: 'ignorar', alvo_id: null, alvo_tabela: null, confianca: 0,
          notas: [`Repetido da linha ${jaVisto} (mesmo ${chave.rotulo}) — junte os dados à mão se forem registros diferentes`]
        });
      }
    }
    for (const { chave, limpar } of preenchidas) {
      vistosNoLote.set(`${chave.campo}:${limpar(item.dados[chave.campo])}`, item.linha);
    }

    // 2) Casamento por chave, da mais forte para a mais fraca.
    for (const { chave, limpar, exato, compacto } of preenchidas) {
      const bruto = item.dados[chave.campo];
      const achadoExato = exato.get(limpar(bruto));
      if (achadoExato) {
        return decidir({
          acao: acaoAoCasar,
          alvo_id: achadoExato.id ?? null,
          alvo_tabela: tabelaDa(achadoExato),
          confianca: 1,
          // Casar por chave fraca não é erro, mas merece conferência: nome
          // igual pode ser filial, homônima ou a mesma empresa.
          notas: chave.forte ? [] : [`Casou por ${chave.rotulo} com "${rotularAlvo(achadoExato)}" — confira se é a mesma`]
        });
      }

      const achadoCompacto = compacto.get(chave.normalizar ? limpar(bruto) : compactar(bruto));
      if (achadoCompacto) {
        return decidir({
          acao: acaoAoCasar,
          alvo_id: achadoCompacto.id ?? null,
          alvo_tabela: tabelaDa(achadoCompacto),
          confianca: 0.9,
          notas: [`Casou com "${rotularAlvo(achadoCompacto)}" ignorando espaços e pontuação — confira`]
        });
      }
    }

    // 3) Parecido, mas não igual. NÃO decide: cadastra como novo e avisa.
    //    Juntar por semelhança misturaria registros diferentes, e o erro só
    //    apareceria depois, no inventário ou na carteira de clientes.
    const fraca = preenchidas.find(i => !i.chave.forte) || preenchidas[0];
    const valorTexto = item.dados[fraca.chave.campo];
    let melhor = null;
    let melhorNota = 0;
    for (const linha of linhas) {
      const nota = semelhanca(valorTexto, linha?.[fraca.coluna]);
      if (nota > melhorNota) { melhorNota = nota; melhor = linha; }
    }

    // Destino que só atualiza: sem alvo, o item não tem para onde ir. Marcar
    // "cadastrar" produziria um erro na hora de aplicar; marcar "descartar"
    // com o motivo escrito manda o revisor para a ação certa — escolher o
    // registro na coluna "O que fazer".
    if (esquema.exigeAlvo) {
      const pista = melhor && melhorNota >= LIMIAR_PARECIDO
        ? ` Parecido com "${rotularAlvo(melhor)}" (#${melhor.id}).`
        : '';
      return decidir({
        acao: 'ignorar', alvo_id: null, alvo_tabela: null,
        confianca: melhor && melhorNota >= LIMIAR_PARECIDO ? Number(melhorNota.toFixed(2)) : 0,
        notas: [`${esquema.motivoSemAlvo || 'Registro não encontrado'}.${pista}`]
      });
    }

    if (melhor && melhorNota >= LIMIAR_PARECIDO) {
      return decidir({
        acao: 'criar', alvo_id: null, alvo_tabela: null, confianca: Number(melhorNota.toFixed(2)),
        notas: [`Parecido com "${rotularAlvo(melhor)}" (#${melhor.id}) — confira se não é o mesmo antes de cadastrar`]
      });
    }

    return decidir({ acao: 'criar', alvo_id: null, alvo_tabela: null, confianca: null });
  });
}

module.exports = { normalizar, compactar, palavras, semelhanca, LIMIAR_PARECIDO, reconciliar };
