const docContainer = document.getElementById('doc-container');
const template = document.getElementById('page-template');

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
  const { rua = '', numero = '', bairro = '', cidade = '', estado = '' } = end;
  return `${rua}, ${numero} – ${bairro} – ${cidade}/${estado}`;
}

async function buildDocument() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) return;
  try {
    const orc = await fetch(`http://localhost:3000/api/orcamentos/${id}`).then(r => r.json());
    const clienteResp = await fetch(`http://localhost:3000/api/clientes/${orc.cliente_id}`).then(r => r.json());
    const cliente = clienteResp.cliente || clienteResp;

    const items = orc.itens.map(it => [
      it.codigo,
      it.nome,
      it.ncm,
      it.quantidade,
      formatCurrency(it.valor_unitario),
      formatCurrency(it.desconto_total),
      formatCurrency(it.valor_total)
    ]);

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
        header = `
      <div class="grid grid-cols-2 gap-2 mb-2">
        <div>
          <p><strong>Número do Orçamento:</strong> ${orc.numero}</p>
          <p><strong>Data de Emissão:</strong> ${new Date(orc.data_emissao).toLocaleDateString('pt-BR')}</p>
          <p><strong>Situação do Orçamento:</strong> ${orc.situacao}</p>
          <p><strong>Quantidade de Parcelas:</strong> ${orc.parcelas}</p>
          <p><strong>Forma de Pagamento:</strong> ${orc.forma_pagamento || ''}</p>
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
          <p><strong>Contato:</strong> ${cliente.comprador_nome || ''}</p>
          <p><strong>Telefone Fixo:</strong> ${cliente.telefone_fixo || ''}</p>
          <p><strong>Telefone Celular:</strong> ${cliente.telefone_celular || ''}</p>
          <p><strong>E-mail:</strong> ${cliente.email || ''}</p>
        </div>
        <div>
          <p><strong>Endereço de Entrega:</strong> ${formatEndereco(cliente.endereco_entrega)}</p>
        </div>
        <div>
          <p><strong>Endereço de Faturamento:</strong> ${formatEndereco(cliente.endereco_cobranca)}</p>
          <p><strong>Endereço de Registro:</strong> ${formatEndereco(cliente.endereco_registro)}</p>
          <p><strong>Transportadora:</strong> ${orc.transportadora || cliente.transportadora || ''}</p>
        </div>
      </div>`;
      }

      const title = isFirst
        ? `ITENS DO ORÇAMENTO (N° ${orc.numero})`
        : `ITENS DO ORÇAMENTO (N° ${orc.numero}) - Continuação`;

      const cols = ['Código','Nome do Produto','NCM','Quantidade','Valor Unitário','Total Desconto','Valor Total'];
      const widths = ['10%','30%','12%','10%','12%','13%','13%'];
      const thead = `<thead><tr>${cols.map((c,i)=>`<th style="width:${widths[i]}">${c}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${chunk.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;

      let html = `
      ${header}
      <h3 class="font-bold text-accent-red mb-1">${title}</h3>
      <table>${thead}${tbody}</table>`;

      if (isLast) {
        html += `
      <div class="text-sm mt-2">
        <h3 class="font-bold text-accent-red mb-1">RESUMO DE VALORES</h3>
        <table class="w-full mb-2">
          <tr><td>Desconto de Pagamento:</td><td class="text-right">${formatCurrency(orc.desconto_pagamento)}</td></tr>
          <tr><td>Desconto Especial:</td><td class="text-right">${formatCurrency(orc.desconto_especial)}</td></tr>
          <tr><td>Desconto Total:</td><td class="text-right">${formatCurrency(orc.desconto_total)}</td></tr>
          <tr class="border-t"><td><strong>Valor a Pagar:</strong></td><td class="text-right"><strong>${formatCurrency(orc.valor_final)}</strong></td></tr>
        </table>
        <p class="font-semibold text-accent-red mb-1">OBSERVAÇÕES:</p>
        <p>${orc.observacoes || '- Nenhuma observação.'}</p>
        <div class="mt-2">
          <p><strong>AUTORIZAÇÃO DO PEDIDO:</strong></p>
          <p>Nome do Responsável: ____________________________</p>
          <p>Assinatura: ____________________________</p>
        </div>
      </div>`;
      } else {
        html += `
      <p class="mt-2"><strong>Nome do Responsável:</strong> ____________________________</p>
      <p><strong>Assinatura:</strong> ____________________________</p>`;
      }

      createPage(html);
    });

    window.print();
  } catch (err) {
    console.error('Erro ao gerar documento', err);
  }
}

window.onload = buildDocument;

