// Leitura dos arquivos enviados ao módulo IA: de arquivo para TEXTO.
//
// Aqui não se estrutura nada — o objetivo é só chegar ao texto que o passo
// seguinte vai transformar em linhas de tabela. Separado de propósito: quando
// um dado sai errado no fim, é este texto que diz se o erro foi de leitura ou
// de interpretação.
//
// ---------------------------------------------------------------------------
// PLANILHA NÃO PASSA PELA IA
//
// Uma planilha já é dado exato e estruturado. Mandá-la para um modelo de visão
// só acrescentaria erro de leitura a um número que estava certo — além de
// custar crédito à toa. Ela é aberta aqui mesmo, na máquina do usuário, e vira
// texto tabular. PDF e foto, que não têm essa sorte, vão para o Gemini.
//
// ---------------------------------------------------------------------------
// O ARQUIVO NÃO FICA GUARDADO
//
// O conteúdo binário vive só na memória desta requisição: é lido, convertido em
// texto e descartado. A API externa só fala JSON e não tem rota para receber
// arquivo; guardar o binário exigiria infraestrutura que não existe. Fica o
// texto extraído, que é o que serve para reprocessar e para auditar.

const path = require('path');
const ExcelJS = require('exceljs');
const provedores = require('./iaProvedores');

const { erro, LIMITES } = provedores;

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

const EXTENSOES = {
  '.xlsx': 'planilha',
  '.xlsm': 'planilha',
  '.csv': 'planilha',
  '.txt': 'planilha',
  '.tsv': 'planilha',
  '.pdf': 'pdf',
  '.jpg': 'imagem',
  '.jpeg': 'imagem',
  '.png': 'imagem',
  '.webp': 'imagem',
  '.heic': 'imagem',
  '.heif': 'imagem'
};

const MIME_POR_EXTENSAO = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
};

/** Extensões aceitas, para a mensagem de erro e para o `accept` do front. */
const EXTENSOES_ACEITAS = Object.keys(EXTENSOES);

/**
 * Decide o caminho de leitura pela EXTENSÃO, não pelo mime declarado.
 *
 * O mime chega do navegador e varia com o sistema do usuário: o mesmo .xlsx
 * aparece como `application/vnd.openxmlformats-...`, `application/zip` ou
 * `application/octet-stream` dependendo da máquina. A extensão é o que o
 * usuário de fato escolheu.
 */
function classificarArquivo(nomeArquivo, mimeDeclarado) {
  const nome = String(nomeArquivo || '').trim();
  const ext = path.extname(nome).toLowerCase();

  // .xls antigo (BIFF) é um formato completamente diferente do .xlsx, e a
  // biblioteca não lê. Recusar com instrução é melhor do que tentar e devolver
  // uma planilha em branco que passaria por "arquivo sem dados".
  if (ext === '.xls') {
    throw erro(400, `"${nome}": o formato .xls antigo não é lido. Abra no Excel e salve como .xlsx ou .csv.`);
  }

  const origem = EXTENSOES[ext];
  if (!origem) {
    throw erro(400,
      `"${nome}": tipo não aceito. Envie ${EXTENSOES_ACEITAS.join(', ')}.`);
  }

  return {
    origem,
    extensao: ext,
    // Para PDF e imagem o mime vai para o Gemini, então precisa ser um dos que
    // ele conhece — o que o navegador declarou não serve como palavra final.
    mime: MIME_POR_EXTENSAO[ext] || String(mimeDeclarado || '') || 'application/octet-stream'
  };
}

// ---------------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------------

/**
 * Valor de uma célula em texto.
 *
 * O exceljs devolve tipos ricos: fórmula vira `{ formula, result }`, texto
 * formatado vira `{ richText: [...] }`, link vira `{ text, hyperlink }`. Um
 * `String(celula)` cru transformaria tudo isso em "[object Object]" — e a
 * coluna inteira de preços calculados por fórmula sumiria.
 */
function valorDaCelula(valor) {
  if (valor === null || valor === undefined) return '';

  if (valor instanceof Date) {
    const dia = String(valor.getUTCDate()).padStart(2, '0');
    const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
    return `${dia}/${mes}/${valor.getUTCFullYear()}`;
  }

  if (typeof valor === 'object') {
    // Fórmula: o que interessa é o RESULTADO, não a expressão.
    if ('result' in valor) return valorDaCelula(valor.result);
    if (Array.isArray(valor.richText)) return valor.richText.map(p => p?.text || '').join('');
    if ('text' in valor) return String(valor.text);
    if ('hyperlink' in valor) return String(valor.hyperlink);
    // Célula com erro (#DIV/0!, #N/D). Vale registrar em vez de virar vazio:
    // uma coluna de preço cheia de #N/D explica por que o dado saiu estranho.
    if ('error' in valor) return String(valor.error);
    return '';
  }

  return String(valor);
}

/** Separador provável de um CSV: o que mais aparece na primeira linha. */
function detectarSeparador(primeiraLinha) {
  const candidatos = [';', ',', '\t', '|'];
  let melhor = ';';
  let maior = -1;
  for (const sep of candidatos) {
    const n = primeiraLinha.split(sep).length - 1;
    if (n > maior) { maior = n; melhor = sep; }
  }
  // Sem nenhum separador, a linha inteira é um campo só — tratar como ';'
  // mantém o resto do fluxo igual.
  return maior > 0 ? melhor : ';';
}

/**
 * CSV lido à mão em vez de por biblioteca.
 *
 * O que sai daqui vai virar texto para um modelo de linguagem ler, não um
 * objeto tipado — então o que importa é separar as células respeitando aspas,
 * e isso cabe em vinte linhas. O separador é detectado porque o Excel em
 * português exporta com `;`, e assumir `,` juntaria a planilha inteira numa
 * coluna só.
 */
function lerCsv(texto) {
  const conteudo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const primeira = conteudo.split('\n', 1)[0] || '';
  const sep = detectarSeparador(primeira);

  const linhas = [];
  let celulas = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < conteudo.length; i++) {
    const c = conteudo[i];

    if (dentroDeAspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { atual += '"'; i++; }
        else dentroDeAspas = false;
      } else {
        atual += c;
      }
      continue;
    }

    if (c === '"') { dentroDeAspas = true; continue; }
    if (c === sep) { celulas.push(atual); atual = ''; continue; }
    if (c === '\n') { celulas.push(atual); linhas.push(celulas); celulas = []; atual = ''; continue; }
    atual += c;
  }
  if (atual !== '' || celulas.length) { celulas.push(atual); linhas.push(celulas); }

  return linhas
    .map(l => l.map(c => c.trim()))
    .filter(l => l.some(c => c !== ''));
}

/** Uma planilha do exceljs vira linhas de células em texto. */
function linhasDaAba(aba) {
  const linhas = [];
  aba.eachRow({ includeEmpty: false }, linha => {
    const celulas = [];
    // `values` do exceljs é 1-indexado (a posição 0 vem vazia). Iterar por
    // `eachCell` pularia colunas vazias no MEIO e desalinharia a linha da
    // seguinte — que é justamente o que embaralha uma tabela.
    const total = Math.max(aba.columnCount || 0, (linha.values?.length || 1) - 1);
    for (let c = 1; c <= total; c++) {
      celulas.push(valorDaCelula(linha.getCell(c).value).trim());
    }
    while (celulas.length && celulas[celulas.length - 1] === '') celulas.pop();
    if (celulas.some(v => v !== '')) linhas.push(celulas);
  });
  return linhas;
}

/**
 * Abre a planilha e devolve o conteúdo como texto tabular.
 *
 * O formato de saída (`a | b | c`, uma linha por linha) é o mesmo pedido ao
 * Gemini para as tabelas de PDF. Uniformizar aqui faz o passo de estruturação
 * enxergar sempre a mesma coisa, venha de onde vier.
 */
async function lerPlanilha(buffer, nomeArquivo, extensao) {
  const nome = String(nomeArquivo || 'planilha');

  if (extensao === '.csv' || extensao === '.txt' || extensao === '.tsv') {
    const linhas = lerCsv(buffer.toString('utf8'));
    if (!linhas.length) return { texto: '', abas: 0, linhas: 0, vazio: true };
    return {
      texto: [`Arquivo: ${nome}`, ...linhas.map(l => l.join(' | '))].join('\n'),
      abas: 1,
      linhas: linhas.length,
      vazio: false
    };
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (e) {
    throw erro(400, `"${nome}": não foi possível abrir a planilha. O arquivo pode estar corrompido ou protegido por senha.`);
  }

  const partes = [];
  let totalLinhas = 0;
  let abas = 0;

  wb.eachSheet(aba => {
    const linhas = linhasDaAba(aba);
    if (!linhas.length) return;
    abas += 1;
    totalLinhas += linhas.length;
    // O nome da aba entra no texto: numa planilha de fornecedor ele costuma
    // ser a categoria ("Chapas", "Ferragens") e é informação de verdade.
    partes.push(`Planilha: ${aba.name}`);
    partes.push(...linhas.map(l => l.join(' | ')));
    partes.push('');
  });

  if (!partes.length) return { texto: '', abas: 0, linhas: 0, vazio: true };
  return {
    texto: [`Arquivo: ${nome}`, '', ...partes].join('\n').trim(),
    abas,
    linhas: totalLinhas,
    vazio: false
  };
}

// ---------------------------------------------------------------------------
// Corte do texto
// ---------------------------------------------------------------------------

/**
 * Corta o texto no limite configurado.
 *
 * A API externa recusa corpo de requisição grande, e o texto de um PDF longo
 * passa fácil disso. O corte é anunciado dentro do próprio texto: se o final
 * do documento não entrou, quem revisar precisa saber que faltam itens — e não
 * concluir que o documento acabou ali.
 */
function limitarTexto(texto) {
  const limite = LIMITES.textoMaxChars();
  const valor = String(texto || '');
  if (valor.length <= limite) return { texto: valor, cortado: false };
  const aviso = `\n\n[...] Texto cortado em ${limite.toLocaleString('pt-BR')} caracteres — o final do documento não entrou.`;
  return { texto: valor.slice(0, limite - aviso.length) + aviso, cortado: true };
}

// ---------------------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------------------

/**
 * Lê um arquivo e devolve `{ origem, texto, aviso }`.
 *
 * Não lança quando a leitura falha: devolve `{ erro }`. Um arquivo ruim no meio
 * de dez não pode derrubar o lote inteiro — o usuário perderia o que já foi
 * lido e teria de reenviar tudo, sem saber qual dos dez era o problema.
 */
async function lerArquivo({ nome, mime, buffer }, opcoes = {}) {
  let classificacao;
  try {
    classificacao = classificarArquivo(nome, mime);
  } catch (e) {
    return { origem: null, mime: mime || null, texto: '', erro: e.message };
  }

  const { origem, extensao } = classificacao;

  try {
    if (origem === 'planilha') {
      const r = await lerPlanilha(buffer, nome, extensao);
      if (r.vazio) return { origem, mime: classificacao.mime, texto: '', erro: 'A planilha não tem nenhuma linha preenchida.' };
      const { texto, cortado } = limitarTexto(r.texto);
      return {
        origem,
        mime: classificacao.mime,
        texto,
        paginas: r.abas || null,
        aviso: cortado ? 'O texto foi cortado por tamanho.' : null
      };
    }

    const r = await provedores.lerComGemini({
      buffer,
      mime: classificacao.mime,
      modelo: opcoes.modelo
    });
    if (r.vazio) {
      return {
        origem,
        mime: classificacao.mime,
        texto: '',
        erro: origem === 'pdf'
          ? 'Nada foi lido deste PDF. Se ele for escaneado, tente uma digitalização mais nítida.'
          : 'Nada foi lido desta imagem. Tente uma foto mais nítida e enquadrada.'
      };
    }
    const { texto, cortado } = limitarTexto(r.texto);
    return {
      origem,
      mime: classificacao.mime,
      texto,
      // O consumo da LEITURA. É o Gemini quem processa o PDF e a foto, então
      // é ele quem gasta mais contexto — e era justamente ele que aparecia
      // zerado na tela de configuração.
      consumo: r.consumo || null,
      aviso: (r.truncado || cortado) ? 'A leitura foi cortada por tamanho — o final do documento pode não ter entrado.' : null
    };
  } catch (e) {
    return { origem, mime: classificacao.mime, texto: '', erro: e.message || 'Falha ao ler o arquivo.' };
  }
}

module.exports = {
  EXTENSOES,
  EXTENSOES_ACEITAS,
  MIME_POR_EXTENSAO,
  classificarArquivo,
  valorDaCelula,
  detectarSeparador,
  lerCsv,
  lerPlanilha,
  limitarTexto,
  lerArquivo
};
