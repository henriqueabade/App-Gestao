const docContainer = document.getElementById('doc-container');
const template = document.getElementById('page-template');

window.pdfBuildReady = false;
window.pdfBuildError = null;
window.generatedPdfMeta = null;

const thresholdSingle = 13;
const maxFirst = 20;
const maxFullNext = 30;
const maxLastNext = 23;
const minLastItems = 4;

function createPage(html) {
  const clone = template.content.cloneNode(true);
  clone.querySelector('.page-content').innerHTML = html;
  docContainer.appendChild(clone);
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

    const items = orc.itens.map(it => ({
      codigo: it.codigo,
      nome: it.nome,
      ncm: it.ncm,
      quantidade: Number(it.quantidade || 0).toLocaleString('pt-BR'),
      valorUnitario: formatCurrency(it.valor_unitario),
      desconto: formatCurrency(it.desconto_total),
      total: formatCurrency(it.valor_total)
    }));

    const total = items.length;
    let pages = [];
    let rem = items.slice();

    if (total <= thresholdSingle) {
      pages.push(rem.splice(0, rem.length));
    } else {
      let firstCount = Math.min(maxFirst, rem.length - minLastItems);
      if (firstCount < thresholdSingle) {
        firstCount = Math.min(rem.length, thresholdSingle);
      }
      pages.push(rem.splice(0, firstCount));

      while (rem.length > maxLastNext) {
        let chunkSize = maxFullNext;
        if (rem.length - maxFullNext < minLastItems) {
          chunkSize = rem.length - minLastItems;
        }
        pages.push(rem.splice(0, chunkSize));
      }

      if (rem.length > 0) {
        pages.push(rem.splice(0, rem.length));
      }
    }

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

      const docTitle = tipo === 'pedido' ? 'PEDIDO' : 'ORÇAMENTO';
      const title = isFirst
        ? `ITENS DO ${docTitle} (N° ${orc.numero})`
        : `ITENS DO ${docTitle} (N° ${orc.numero}) - Continuação`;

      const columns = [
        { key: 'codigo', label: 'Código', width: '10%', align: 'left' },
        { key: 'nome', label: 'Nome do Produto', width: '30%', align: 'left' },
        { key: 'ncm', label: 'NCM', width: '12%', align: 'left' },
        { key: 'quantidade', label: 'Quantidade', width: '10%', align: 'center' },
        { key: 'valorUnitario', label: 'Valor Unitário', width: '12%', align: 'right' },
        { key: 'desconto', label: 'Total Desconto', width: '13%', align: 'right' },
        { key: 'total', label: 'Valor Total', width: '13%', align: 'right' }
      ];

      const thead = `<thead><tr>${columns
        .map(col => `<th style="width:${col.width};text-align:${col.align};">${col.label}</th>`)
        .join('')}</tr></thead>`;

      const tbody = `<tbody>${chunk
        .map(row => `<tr>${columns
          .map(col => `<td style="text-align:${col.align};">${row[col.key] ?? ''}</td>`)
          .join('')}</tr>`)
        .join('')}</tbody>`;

      let html = `
      ${header}
      <h3 class="font-bold text-accent-red mb-1">${title}</h3>
      <table>${thead}${tbody}</table>`;

      if (isLast) {
        html += `
      <div class="text-sm mt-2">
        <h3 class="font-bold text-accent-red mb-1">RESUMO DE VALORES</h3>
        <table class="w-full mb-2">
          <tr><td style="text-align:left;">Desconto de Pagamento:</td><td style="text-align:right;">${formatCurrency(orc.desconto_pagamento)}</td></tr>
          <tr><td style="text-align:left;">Desconto Especial:</td><td style="text-align:right;">${formatCurrency(orc.desconto_especial)}</td></tr>
          <tr><td style="text-align:left;">Desconto Total:</td><td style="text-align:right;">${formatCurrency(orc.desconto_total)}</td></tr>
          <tr class="border-t"><td style="text-align:left;"><strong>Valor a Pagar:</strong></td><td style="text-align:right;"><strong>${formatCurrency(orc.valor_final)}</strong></td></tr>
        </table>
        <p class="font-semibold text-accent-red mb-1">OBSERVAÇÕES:</p>
        <p>${(orc.observacoes && orc.observacoes.trim()
            ? orc.observacoes.trim()
            : '- Nenhuma observação.'
          ).replace(/\n/g, '<br/>')}</p>
        <div class="mt-2">`;
        if (tipo === 'pedido') {
          html += `<p><strong>PEDIDO AUTORIZADO</strong></p>`;
        } else {
          html += `<p><strong>AUTORIZAÇÃO DO PEDIDO:</strong></p>
          <p>Nome do Responsável: _______________________________</p>
          <p>Assinatura: _______________________________</p>`;
        }
        html += `
        </div>
      </div>`;
      } else {
        if (tipo !== 'pedido') {
          html += `
      <div class="mt-2">
        <p><strong>Nome do Responsável:</strong> _______________________________</p>
        <p><strong>Assinatura:</strong> _______________________________</p>
      </div>`;
        }
      }

      createPage(html);
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

