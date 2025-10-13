const docContainer = document.getElementById('doc-container');
const template = document.getElementById('page-template');

function ensureDocContainer() {
  if (!docContainer) {
    throw new Error('Container principal do documento não encontrado.');
  }
  return docContainer;
}

function renderStatusCard({ title, message, details, variant = 'info' }) {
  const container = ensureDocContainer();
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = `doc-status doc-status--${variant}`;

  if (title) {
    const heading = document.createElement('h1');
    heading.textContent = title;
    wrapper.appendChild(heading);
  }

  if (message) {
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    wrapper.appendChild(paragraph);
  }

  if (details) {
    const detailBlock = document.createElement('pre');
    detailBlock.textContent = details;
    wrapper.appendChild(detailBlock);
  }

  container.appendChild(wrapper);
}

function renderErrorFeedback(title, message, details) {
  renderStatusCard({ title, message, details, variant: 'error' });
}

window.pdfBuildReady = false;
window.pdfBuildError = null;
window.generatedPdfMeta = null;

let apiBaseUrlPromise = null;

async function getApiBaseUrl() {
  if (!apiBaseUrlPromise) {
    apiBaseUrlPromise = (async () => {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('apiBaseUrl');
      if (fromQuery) {
        return fromQuery;
      }

      if (window.apiConfig?.getApiBaseUrl) {
        return window.apiConfig.getApiBaseUrl();
      }

      throw new Error('Configuração de API indisponível para geração de PDF.');
    })().catch(err => {
      apiBaseUrlPromise = null;
      throw err;
    });
  }

  return apiBaseUrlPromise;
}

async function fetchApi(path, options) {
  const baseUrl = await getApiBaseUrl();
  const url = new URL(path, baseUrl);
  const response = await fetch(url.toString(), options);

  if (!response.ok) {
    let responseText = '';
    try {
      responseText = await response.text();
    } catch (textErr) {
      console.warn('Não foi possível ler a resposta de erro da API.', textErr);
    }

    let parsedMessage = '';
    if (responseText) {
      try {
        const parsed = JSON.parse(responseText);
        parsedMessage = parsed?.message || parsed?.error || '';
      } catch (jsonErr) {
        if (!(jsonErr instanceof SyntaxError)) {
          console.warn('Não foi possível converter resposta de erro em JSON.', jsonErr);
        }
      }
    }

    const baseMessage = `Falha ao consultar a API (${response.status || 'desconhecido'})`;
    const errorMessage = parsedMessage ? `${baseMessage}: ${parsedMessage}` : baseMessage;
    const error = new Error(errorMessage);
    error.status = response.status;
    if (responseText) {
      error.details = parsedMessage ? responseText : responseText.slice(0, 1200);
    }
    throw error;
  }

  return response;
}

function createPage() {
  const clone = template.content.cloneNode(true);
  const page = clone.querySelector('.page');
  const content = page.querySelector('.page-content');
  if (content) {
    content.innerHTML = '';
  }
  ensureDocContainer().appendChild(clone);
  return page;
}

function ensureTableFits(page) {
  const table = page.querySelector('.items-table');
  if (!table) return;

  const fontSteps = [11, 10, 9, 8];
  const cells = Array.from(table.querySelectorAll('th, td'));

  table.style.tableLayout = 'fixed';
  table.style.width = '100%';

  for (const size of fontSteps) {
    table.style.fontSize = `${size}px`;
    cells.forEach(cell => {
      cell.style.fontSize = `${size}px`;
      cell.style.lineHeight = '1.2';
      cell.style.whiteSpace = 'nowrap';
    });

    const hasOverflow = cells.some(cell => cell.scrollWidth > cell.clientWidth + 1);
    if (!hasOverflow) {
      break;
    }
  }
}

function formatCurrency(v) {
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function formatEndereco(end) {
  if (!end) return '';
  const { rua = '', numero = '', bairro = '', cidade = '', estado = '', cep = '' } = end;

  const primeiraLinha = [];

  if (rua || numero) {
    const enderecoBase = rua ? `${rua}${numero ? `, ${numero}` : ''}` : numero;
    if (enderecoBase) primeiraLinha.push(enderecoBase);
  }

  if (bairro) primeiraLinha.push(bairro);

  const cidadeEstado = [cidade, estado].filter(Boolean).join('/');
  if (cidadeEstado) primeiraLinha.push(cidadeEstado);

  const linhas = [];
  if (primeiraLinha.length) linhas.push(primeiraLinha.join(' – '));
  if (cep) linhas.push(`CEP: ${cep}`);

  return linhas.join('<br/>');
}

function enderecosIguais(a, b) {
  if (!a || !b) return false;
  const keys = ['rua', 'numero', 'bairro', 'cidade', 'estado', 'cep'];
  return keys.every(k => (a[k] || '') === (b[k] || ''));
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const byNumber = new Date(value);
    return Number.isNaN(byNumber.getTime()) ? null : byNumber;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const dateMatch = trimmed.match(
      /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );

    if (dateMatch) {
      const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = dateMatch;
      const coerced = new Date(
        Number(yyyy),
        Number(mm) - 1,
        Number(dd),
        Number(hh),
        Number(min),
        Number(ss)
      );
      return Number.isNaN(coerced.getTime()) ? null : coerced;
    }
  }

  return null;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return date.toLocaleDateString('pt-BR');
}

function createInfoParagraph(label, value) {
  const p = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}:`;
  p.appendChild(strong);
  p.appendChild(document.createTextNode(` ${value || ''}`));
  return p;
}

function createHeaderSection(data) {
  const {
    orc,
    cliente,
    contato,
    tipo,
    endEntregaStr,
    endCobrancaStr,
    endRegistroStr
  } = data;

  const container = document.createElement('div');
  container.className = 'doc-header';

  const left = document.createElement('div');
  left.className = 'doc-header-column';
  const right = document.createElement('div');
  right.className = 'doc-header-column';

  const numLabel = tipo === 'pedido' ? 'Número do Pedido' : 'Número do Orçamento';
  const sitLabel = tipo === 'pedido' ? 'Situação do Pedido' : 'Situação do Orçamento';

  const docInfo = [
    createInfoParagraph(numLabel, orc.numero),
    createInfoParagraph('Data de Emissão', formatDate(orc.data_emissao)),
    createInfoParagraph(sitLabel, orc.situacao),
    createInfoParagraph('Quantidade de Parcelas', orc.parcelas),
    createInfoParagraph('Forma de Pagamento', orc.forma_pagamento || ''),
    createInfoParagraph('Prazo', orc.prazo || ''),
    createInfoParagraph('Nome Fantasia', cliente.nome_fantasia || ''),
    createInfoParagraph('Razão Social', cliente.razao_social || ''),
    createInfoParagraph('CNPJ', cliente.cnpj || ''),
    createInfoParagraph('Inscrição Estadual', cliente.inscricao_estadual || '')
  ];

  docInfo.forEach(p => left.appendChild(p));

  const contatoNome = contato.nome || orc.contato_nome || cliente.comprador_nome || '';
  const contatoFixo = contato.telefone_fixo || cliente.telefone_fixo || '';
  const contatoCel = contato.telefone_celular || cliente.telefone_celular || '';
  const contatoEmail = contato.email || cliente.email || '';
  const transportadora = orc.transportadora || cliente.transportadora || '';

  const contatoInfo = [
    createInfoParagraph('Contato', contatoNome),
    createInfoParagraph('Telefone Fixo', contatoFixo),
    createInfoParagraph('Telefone Celular', contatoCel),
    createInfoParagraph('E-mail', contatoEmail)
  ];

  contatoInfo.forEach(p => right.appendChild(p));

  const entrega = document.createElement('p');
  entrega.innerHTML = `<strong>Endereço de Entrega:</strong> ${endEntregaStr}`;
  right.appendChild(entrega);

  const faturamento = document.createElement('p');
  faturamento.innerHTML = `<strong>Endereço de Faturamento:</strong> ${endCobrancaStr}`;
  right.appendChild(faturamento);

  const registro = document.createElement('p');
  registro.innerHTML = `<strong>Endereço de Registro:</strong> ${endRegistroStr}`;
  right.appendChild(registro);

  right.appendChild(createInfoParagraph('Transportadora', transportadora));

  container.appendChild(left);
  container.appendChild(right);

  return container;
}

function createTableSkeleton() {
  const cols = ['Código', 'Nome do Produto', 'NCM', 'Quantidade', 'Valor Unitário', 'Desconto Total', 'Valor Total'];
  const widths = ['10%', '34%', '12%', '10%', '12%', '10%', '12%'];

  const table = document.createElement('table');
  table.className = 'items-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  cols.forEach((c, idx) => {
    const th = document.createElement('th');
    th.style.width = widths[idx];
    th.style.textAlign = 'left';
    th.textContent = c;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);

  return { table, tbody };
}

function appendRow(tbody, row) {
  const tr = document.createElement('tr');
  row.forEach(cell => {
    const td = document.createElement('td');
    td.style.textAlign = 'left';
    td.textContent = cell;
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
}

function buildSignatureBlock(tipo, orc, contatoNome = '') {
  if (tipo === 'pedido') {
    const dataAprovacao = formatDate(orc.data_aprovacao);
    const autorizadoPor = (contatoNome || '').trim();
    return `
      <div class="signature-block signature-block--pedido">
        <p class="font-semibold text-accent-red mb-1">AUTORIZAÇÃO DO PEDIDO</p>
        <p><strong>Pedido autorizado por:</strong> ${autorizadoPor}</p>
        <p><strong>Data de Aprovação:</strong> ${dataAprovacao || ''}</p>
      </div>
    `;
  }

  return `
    <div class="signature-block">
      <p class="font-semibold text-accent-red mb-1">ACEITE DO ORÇAMENTO</p>
      <div class="authorization-line">
        <div class="authorization-field">
          <span class="authorization-label">Nome do Responsável:</span>
          <span class="authorization-value"></span>
        </div>
        <div class="authorization-field">
          <span class="authorization-label">Assinatura:</span>
          <span class="authorization-value"></span>
        </div>
      </div>
    </div>
  `;
}

function buildFinalBlock(tipo, orc, contatoNome = '') {
  if (tipo === 'pedido') {
    const dataAprovacao = formatDate(orc.data_aprovacao);
    const autorizadoPor = (contatoNome || '').trim();
    return `
      <div class="final-block">
        <h3 class="font-bold text-accent-red mb-1">RESUMO DE VALORES</h3>
        <table>
          <tr><td>Desconto de Pagamento:</td><td>${formatCurrency(orc.desconto_pagamento)}</td></tr>
          <tr><td>Desconto Especial:</td><td>${formatCurrency(orc.desconto_especial)}</td></tr>
          <tr><td>Desconto Total:</td><td>${formatCurrency(orc.desconto_total)}</td></tr>
          <tr><td><strong>Valor a Pagar:</strong></td><td><strong>${formatCurrency(orc.valor_final)}</strong></td></tr>
        </table>
        <p class="font-semibold text-accent-red mb-1">OBSERVAÇÕES:</p>
        <p>${orc.observacoes || '- Nenhuma observação.'}</p>
        <div class="authorization-block">
          <p class="font-semibold text-accent-red mb-1">AUTORIZAÇÃO DO PEDIDO</p>
          <p><strong>Pedido autorizado por:</strong> ${autorizadoPor}</p>
          <p><strong>Data de Aprovação:</strong> ${dataAprovacao || ''}</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="final-block">
      <h3 class="font-bold text-accent-red mb-1">RESUMO DE VALORES</h3>
      <table>
        <tr><td>Desconto de Pagamento:</td><td>${formatCurrency(orc.desconto_pagamento)}</td></tr>
        <tr><td>Desconto Especial:</td><td>${formatCurrency(orc.desconto_especial)}</td></tr>
        <tr><td>Desconto Total:</td><td>${formatCurrency(orc.desconto_total)}</td></tr>
        <tr><td><strong>Valor a Pagar:</strong></td><td><strong>${formatCurrency(orc.valor_final)}</strong></td></tr>
      </table>
      <p class="font-semibold text-accent-red mb-1">OBSERVAÇÕES:</p>
      <p>${orc.observacoes || '- Nenhuma observação.'}</p>
      <div>
        <p class="font-semibold text-accent-red mb-1">ACEITE DO ORÇAMENTO</p>
        <div class="authorization-line">
          <div class="authorization-field">
            <span class="authorization-label">Nome do Responsável:</span>
            <span class="authorization-value"></span>
          </div>
          <div class="authorization-field">
            <span class="authorization-label">Assinatura:</span>
            <span class="authorization-value"></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function convertToHeaderContinuationPage(page, content, table, tail) {
  if (table) {
    const parent = table.parentNode;
    if (parent) {
      parent.removeChild(table);
    }
  }

  if (tail) {
    const tailParent = tail.parentNode;
    if (tailParent) {
      tailParent.removeChild(tail);
    }
  }

  if (!content.querySelector('.header-only-note')) {
    const continuation = document.createElement('p');
    continuation.className = 'header-only-note';
    continuation.textContent = 'Os itens deste documento continuam na proxima pagina.';
    content.appendChild(continuation);
  }

  page.classList.add('page--header-only');
}

function buildPages(context) {
  const { items, orc, tipo, contatoNomeAssinatura = '' } = context;
  const remaining = items.slice();
  const overflowBuffer = 2;
  let pageIndex = 0;
  let pendingTailHtml = null;

  if (!remaining.length) {
    remaining.push(['', 'Nenhum item disponível', '', '', '', '', '']);
  }

  while (remaining.length > 0 || pendingTailHtml) {
    const isFirst = pageIndex === 0;
    const isTailOnlyPage = pendingTailHtml && remaining.length === 0;
    const page = createPage();
    const content = page.querySelector('.page-content');

    if (!content) break;

    if (isFirst) {
      const header = createHeaderSection(context);
      content.appendChild(header);
    }

    if (isTailOnlyPage) {
      const tail = document.createElement('div');
      tail.className = 'page-tail';
      tail.innerHTML = pendingTailHtml;
      pendingTailHtml = null;
      content.appendChild(tail);
      pageIndex += 1;
      continue;
    }

    const docLabel = tipo === 'pedido' ? 'PEDIDO' : 'ORÇAMENTO';
    const title = document.createElement('h3');
    title.className = 'font-bold text-accent-red mb-1';
    title.textContent = isFirst
      ? `ITENS DO ${docLabel} (N° ${orc.numero})`
      : `ITENS DO ${docLabel} (N° ${orc.numero}) – Continuação`;
    content.appendChild(title);

    const { table, tbody } = createTableSkeleton();
    content.appendChild(table);

    const tail = document.createElement('div');
    tail.className = 'page-tail';
    content.appendChild(tail);

    const pageRows = [];

    while (remaining.length > 0) {
      const row = remaining[0];
      appendRow(tbody, row);
      ensureTableFits(page);

      if (content.scrollHeight > content.clientHeight - overflowBuffer) {
        tbody.removeChild(tbody.lastElementChild);
        ensureTableFits(page);
        break;
      }

      pageRows.push(remaining.shift());
    }

    let isLastPage = remaining.length === 0 && !pendingTailHtml;
    const finalTailHtml = buildFinalBlock(tipo, orc, contatoNomeAssinatura);
    const signatureTailHtml = buildSignatureBlock(tipo, orc, contatoNomeAssinatura);

    tail.innerHTML = isLastPage ? finalTailHtml : signatureTailHtml;
    ensureTableFits(page);

    let safety = 0;
    while (
      content.scrollHeight > content.clientHeight - overflowBuffer &&
      pageRows.length > 0 &&
      safety < 200
    ) {
      safety += 1;
      const last = pageRows.pop();
      tbody.removeChild(tbody.lastElementChild);
      remaining.unshift(last);

      if (isLastPage) {
        isLastPage = false;
        tail.innerHTML = signatureTailHtml;
      }

      ensureTableFits(page);
    }

    if (content.scrollHeight > content.clientHeight - overflowBuffer) {
      if (isLastPage) {
        pendingTailHtml = finalTailHtml;
        tail.innerHTML = signatureTailHtml;
        ensureTableFits(page);

        if (tbody.rows.length === 0) {
          if (isFirst) {
            convertToHeaderContinuationPage(page, content, table, tail);
          } else {
            page.remove();
          }
          pageIndex += 1;
          continue;
        }
      } else if (!pageRows.length) {
        tail.style.fontSize = '0.72rem';
      }
    }

    if (tbody.rows.length === 0 && !isLastPage) {
      if (isFirst) {
        convertToHeaderContinuationPage(page, content, table, tail);
      } else {
        page.remove();
      }
      pageIndex += 1;
      continue;
    }

    pageIndex += 1;
  }
}

function extractHelpfulDetails(err) {
  if (!err) return null;

  if (err.details) {
    return typeof err.details === 'string' ? err.details : JSON.stringify(err.details, null, 2);
  }

  if (err.status === 404) {
    return 'O documento solicitado não foi encontrado. Verifique se o número informado ainda existe na base.';
  }

  if (err.status === 401 || err.status === 403) {
    return 'A API retornou um erro de autorização. Confirme suas credenciais ou permissões.';
  }

  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return 'Não foi possível conectar-se à API. Verifique se o servidor está em execução e acessível.';
  }

  return null;
}

async function buildDocument() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const tipo = params.get('tipo') || 'orcamento';
  if (!id) {
    const message = 'Inclua o parâmetro "id" na URL para que o documento possa ser gerado.';
    renderErrorFeedback('Documento não especificado', message);
    window.pdfBuildError = message;
    window.dispatchEvent(new CustomEvent('pdf-build-error', { detail: window.pdfBuildError }));
    return;
  }

  renderStatusCard({
    title: 'Gerando documento',
    message: 'Buscando informações na API. Aguarde...',
    variant: 'info'
  });
  try {
    const endpoint = tipo === 'pedido' ? 'pedidos' : 'orcamentos';
    const orc = await fetchApi(`/api/${endpoint}/${id}`).then(r => r.json());
    document.title = `${tipo === 'pedido' ? 'Pedido' : 'Orçamento'} – Barral & Santíssimo`;
    const clienteResp = await fetchApi(`/api/clientes/${orc.cliente_id}`).then(r => r.json());
    const cliente = clienteResp.cliente || clienteResp;
    const contatos = clienteResp.contatos || [];
    const contato = contatos.find(c => c.id === orc.contato_id) || contatos[0] || {};
    const contatoNomeAssinatura = (contato?.nome || orc?.contato_nome || cliente?.comprador_nome || '').trim();

    window.generatedPdfMeta = {
      id,
      tipo,
      numero: orc.numero,
      situacao: orc.situacao
    };

    const endEntrega = cliente.endereco_entrega;
    const endCobranca = cliente.endereco_cobranca;
    const endRegistro = cliente.endereco_registro;

    const endEntregaStr = formatEndereco(endEntrega);
    const endCobrancaStr = enderecosIguais(endCobranca, endEntrega)
      ? 'Igual Endereço de Entrega'
      : formatEndereco(endCobranca);
    const endRegistroStr = enderecosIguais(endRegistro, endEntrega)
      ? 'Igual Endereço de Entrega'
      : enderecosIguais(endRegistro, endCobranca)
        ? 'Igual Endereço de Faturamento'
        : formatEndereco(endRegistro);

    const items = (orc.itens || []).map(it => ([
      it.codigo ?? '',
      it.nome ?? '',
      it.ncm ?? '',
      Number(it.quantidade || 0).toLocaleString('pt-BR'),
      formatCurrency(it.valor_unitario),
      formatCurrency(it.desconto_total),
      formatCurrency(it.valor_total)
    ]));

    ensureDocContainer().innerHTML = '';
    buildPages({
      items,
      orc,
      tipo,
      cliente,
      contato,
      contatoNomeAssinatura,
      endEntregaStr,
      endCobrancaStr,
      endRegistroStr
    });

    window.pdfBuildReady = true;
    window.dispatchEvent(new Event('pdf-build-ready'));
  } catch (err) {
    console.error('Erro ao gerar documento', err);
    window.pdfBuildError = err?.message || 'Erro ao gerar documento';
    window.dispatchEvent(new CustomEvent('pdf-build-error', { detail: window.pdfBuildError }));
    const errorDetails = extractHelpfulDetails(err);
    renderErrorFeedback('Erro ao gerar documento', window.pdfBuildError, errorDetails);
  }
}

window.onload = buildDocument;
