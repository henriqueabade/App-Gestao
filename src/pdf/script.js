const docContainer = document.getElementById('doc-container');
const template = document.getElementById('page-template');

window.pdfBuildReady = false;
window.pdfBuildError = null;
window.generatedPdfMeta = null;

const TH_SINGLE = 8;
const CAP_FIRST = 12;
const CAP_FULL = 22;
const CAP_LAST = 15;
const MIN_LAST_ITEMS = 4;
const FINAL_BLOCK_RESERVED = 7;

function createPage(html) {
  const clone = template.content.cloneNode(true);
  const page = clone.querySelector('.page');
  page.querySelector('.page-content').innerHTML = html;
  docContainer.appendChild(clone);
  return docContainer.lastElementChild;
}

function ensureTableFits(page) {
  const table = page.querySelector('.items-table');
  if (!table) return;

  const fontSteps = [11, 10, 9, 8];
  const cells = Array.from(table.querySelectorAll('th, td'));

  for (const size of fontSteps) {
    table.style.fontSize = `${size}px`;
    cells.forEach(cell => {
      cell.style.fontSize = `${size}px`;
      cell.style.lineHeight = '1.2';
    });

    const hasOverflow = cells.some(cell => cell.scrollWidth > cell.clientWidth + 1);
    if (!hasOverflow) {
      break;
    }
  }
}

function paginateItems(items) {
  const total = items.length;

  if (total === 0) {
    return [[]];
  }

  const canSinglePage = total <= CAP_FIRST && total + FINAL_BLOCK_RESERVED <= CAP_FULL;

  if (total <= TH_SINGLE || canSinglePage) {
    return [items.slice()];
  }

  const pages = [];
  let remaining = items.slice();

  let firstCount = Math.min(CAP_FIRST, remaining.length - MIN_LAST_ITEMS);
  if (firstCount < TH_SINGLE && remaining.length - TH_SINGLE >= MIN_LAST_ITEMS) {
    firstCount = TH_SINGLE;
  }
  if (remaining.length - firstCount < MIN_LAST_ITEMS) {
    firstCount = Math.max(remaining.length - MIN_LAST_ITEMS, TH_SINGLE);
  }
  firstCount = Math.max(1, Math.min(firstCount, CAP_FIRST));

  pages.push(remaining.splice(0, firstCount));

  while (remaining.length > CAP_LAST) {
    let chunkSize = Math.min(CAP_FULL, remaining.length - MIN_LAST_ITEMS);
    if (remaining.length - chunkSize < MIN_LAST_ITEMS) {
      chunkSize = remaining.length - MIN_LAST_ITEMS;
    }
    if (chunkSize > CAP_FULL) {
      chunkSize = CAP_FULL;
    }
    if (chunkSize < MIN_LAST_ITEMS) {
      chunkSize = MIN_LAST_ITEMS;
    }

    pages.push(remaining.splice(0, chunkSize));
  }

  let lastChunk = remaining.splice(0, remaining.length);

  if (lastChunk.length < MIN_LAST_ITEMS && pages.length > 0) {
    const prev = pages[pages.length - 1];
    const needed = MIN_LAST_ITEMS - lastChunk.length;
    const transfer = prev.splice(Math.max(prev.length - needed, 0), needed);
    lastChunk = transfer.concat(lastChunk);
  }

  if (lastChunk.length > CAP_LAST) {
    while (lastChunk.length > CAP_LAST) {
      pages.push(lastChunk.splice(0, CAP_FULL));
    }
  }

  if (lastChunk.length > 0) {
    pages.push(lastChunk);
  }

  return pages;
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

async function buildDocument() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const tipo = params.get('tipo') || 'orcamento';
  if (!id) return;
  try {
    const endpoint = tipo === 'pedido' ? 'pedidos' : 'orcamentos';
    const orc = await fetch(`http://localhost:3000/api/${endpoint}/${id}`).then(r => r.json());
    document.title = `${tipo === 'pedido' ? 'Pedido' : 'Orçamento'} – Barral & Santíssimo`;
    const clienteResp = await fetch(`http://localhost:3000/api/clientes/${orc.cliente_id}`).then(r => r.json());
    const cliente = clienteResp.cliente || clienteResp;
    const contatos = clienteResp.contatos || [];
    const contato = contatos.find(c => c.id === orc.contato_id) || contatos[0] || {};

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

    const items = orc.itens.map(it => ([
      it.codigo ?? '',
      it.nome ?? '',
      it.ncm ?? '',
      Number(it.quantidade || 0).toLocaleString('pt-BR'),
      formatCurrency(it.valor_unitario),
      formatCurrency(it.desconto_total),
      formatCurrency(it.valor_total)
    ]));

    const pages = paginateItems(items);

    pages.forEach((chunk, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === pages.length - 1;

      let header = '';
      if (isFirst) {
        const numLabel = tipo === 'pedido' ? 'Número do Pedido' : 'Número do Orçamento';
        const sitLabel = tipo === 'pedido' ? 'Situação do Pedido' : 'Situação do Orçamento';
        header = `
      <div class="grid grid-cols-2 gap-2 mb-2">
        <div>
          <p><strong>${numLabel}:</strong> ${orc.numero}</p>
          <p><strong>Data de Emissão:</strong> ${new Date(orc.data_emissao).toLocaleDateString('pt-BR')}</p>
          <p><strong>${sitLabel}:</strong> ${orc.situacao}</p>
          <p><strong>Quantidade de Parcelas:</strong> ${orc.parcelas}</p>
          <p><strong>Forma de Pagamento:</strong> ${orc.forma_pagamento || ''}</p>
          <p><strong>Prazo:</strong> ${orc.prazo || ''}</p>
        </div>
        <div class="text-right">
          <p><strong>Nome Fantasia:</strong> ${cliente.nome_fantasia || ''}</p>
          <p><strong>Razão Social:</strong> ${cliente.razao_social || ''}</p>
          <p><strong>CNPJ:</strong> ${cliente.cnpj || ''}</p>
          <p><strong>Inscrição Estadual:</strong> ${cliente.inscricao_estadual || ''}</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-2">
        <div>
          <p><strong>Contato:</strong> ${contato.nome || cliente.comprador_nome || ''}</p>
          <p><strong>Telefone Fixo:</strong> ${contato.telefone_fixo || cliente.telefone_fixo || ''}</p>
          <p><strong>Telefone Celular:</strong> ${contato.telefone_celular || cliente.telefone_celular || ''}</p>
          <p><strong>E-mail:</strong> ${contato.email || cliente.email || ''}</p>
        </div>
        <div>
          <p><strong>Endereço de Entrega:</strong> ${endEntregaStr}</p>
        </div>
        <div>
          <p><strong>Endereço de Faturamento:</strong> ${endCobrancaStr}</p>
          <p><strong>Endereço de Registro:</strong> ${endRegistroStr}</p>
          <p><strong>Transportadora:</strong> ${orc.transportadora || cliente.transportadora || ''}</p>
        </div>
      </div>`;
      }

      const docLabel = tipo === 'pedido' ? 'PEDIDO' : 'ORÇAMENTO';
      const title = isFirst
        ? `ITENS DO ${docLabel} (N° ${orc.numero})`
        : `ITENS DO ${docLabel} (N° ${orc.numero}) – Continuação`;

      const cols = ['Código', 'Nome do Produto', 'NCM', 'Quantidade', 'Valor Unitário', 'Desconto Total', 'Valor Total'];
      const widths = ['10%', '34%', '12%', '10%', '12%', '10%', '12%'];
      const thead = `<thead><tr>${cols.map((c,i)=>`<th style="width:${widths[i]};text-align:left;">${c}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${chunk.map(row=>`<tr>${row.map(cell=>`<td style="text-align:left;">${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;

      let html = `
      ${header}
      <h3 class="font-bold text-accent-red mb-1">${title}</h3>
      <table class="items-table">${thead}${tbody}</table>`;

      if (isLast) {
        html += `
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
          <p class="font-semibold text-accent-red mb-1">AUTORIZAÇÃO DO PEDIDO</p>
          <div class="authorization-line">
            <span>Nome do Responsável: _______________________________</span>
            <span>Assinatura: _______________________________</span>
          </div>
        </div>
      </div>`;
      } else if (!isFirst) {
        html += `
      <div class="signature-block">
        <p><strong>Nome do Responsável:</strong> _______________________________</p>
        <p><strong>Assinatura:</strong> _______________________________</p>
      </div>`;
      }

      const pageEl = createPage(html);
      ensureTableFits(pageEl);
    });

    window.pdfBuildReady = true;
    window.dispatchEvent(new Event('pdf-build-ready'));

    // Printing is now user-initiated; remove automatic print dialog
  } catch (err) {
    console.error('Erro ao gerar documento', err);
    window.pdfBuildError = err?.message || 'Erro ao gerar documento';
    window.dispatchEvent(new CustomEvent('pdf-build-error', { detail: window.pdfBuildError }));
  }
}

window.onload = buildDocument;

