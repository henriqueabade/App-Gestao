const docContainer = document.getElementById('doc-container');
const template     = document.getElementById('page-template');

// Configurações da lógica de paginação
const thresholdSingle = 13;    // até 13 itens cabe tudo numa página só
const maxFirst        = 20;    // itens máximos na 1ª página, antes de distribuir o resto
const maxFullNext     = 30;    // itens máximos em cada página intermediária
const maxLastNext     = 23;    // itens máximos na última página (30 totais menos 7 do bloco)
const minLastItems    = 4;     // mínimo de itens na última página

// Arrays de exemplo
const finishes = ['Off-white','Grafite','Prata','Verde','Madeira','Braco','Veludo'];
const lines    = ['Acervo','Essencial','Infinito','Favo','Rio'];
const products = ['Bandeja','Caixa','Base','Vaso'];
const sizes    = ['P','M','G'];

// Gera 60 itens de exemplo
const items = Array.from({length:84}, (_, i) => {
  const idx  = i + 1;
  const name = `${products[i%products.length]} ${lines[i%lines.length]} ${sizes[i%sizes.length]} ${finishes[i%finishes.length]}`;
  const qty  = (i % 5) + 1;
  const unit = (idx * 10).toFixed(2);
  const disc = idx.toFixed(2);
  const tot  = ((qty * parseFloat(unit)) - parseFloat(disc)).toFixed(2);
  return [
    `COD${idx}`,
    name,
    `NCM${1000 + idx}`,
    `${qty}`,
    `R$ ${unit}`,
    `R$ ${disc}`,
    `R$ ${tot}`
  ];
});

function createPage(html) {
  const clone = template.content.cloneNode(true);
  clone.querySelector('.page-content').innerHTML = html;
  docContainer.appendChild(clone);
}

function buildDocument() {
  const total = items.length;
  let pages  = [];
  let rem    = items.slice();

  // Caso caiba tudo numa página só
  if (total <= thresholdSingle) {
    pages.push(rem.splice(0, rem.length));

  } else {
    // 1) Fatia a 1ª página
    // garante que sobrem ao menos minLastItems para a última página
    let firstCount = Math.min(maxFirst, rem.length - minLastItems);
    // mas jamais menos que thresholdSingle, para caber o bloco
    if (firstCount < thresholdSingle) {
      firstCount = Math.min(rem.length, thresholdSingle);
    }
    pages.push(rem.splice(0, firstCount));

    // 2) Páginas intermediárias de até maxFullNext
    while (rem.length > maxLastNext) {
      let chunkSize = maxFullNext;
      // se sobraria menos que minLastItems para a última, ajusta
      if (rem.length - maxFullNext < minLastItems) {
        chunkSize = rem.length - minLastItems;
      }
      pages.push(rem.splice(0, chunkSize));
    }

    // 3) Última página
    if (rem.length > 0) {
      pages.push(rem.splice(0, rem.length));
    }
  }

  // Gera cada página
  pages.forEach((chunk, idx) => {
    const isFirst = idx === 0;
    const isLast  = idx === pages.length - 1;

    // Cabeçalho só na 1ª página
    let header = '';
    if (isFirst) {
      header = `
      <div class="grid grid-cols-2 gap-2 mb-2">
        <div>
          <p><strong>Número do Orçamento:</strong> 12</p>
          <p><strong>Data de Emissão:</strong> 26/10/2023</p>
          <p><strong>Situação do Orçamento:</strong> Finalizado</p>
          <p><strong>Quantidade de Parcelas:</strong> 1</p>
          <p><strong>Forma de Pagamento:</strong> À Vista</p>
        </div>
        <div class="text-right">
          <p><strong>Nome Fantasia:</strong> RARARA</p>
          <p><strong>Razão Social:</strong> HAHAHA</p>
          <p><strong>CNPJ:</strong> 99.999.999/9999-99</p>
          <p><strong>Inscrição Estadual:</strong> 999999999</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-2">
        <div>
          <p><strong>Contato:</strong> AHARA</p>
          <p><strong>Telefone Fixo:</strong> (31) 3357-4894</p>
          <p><strong>Telefone Celular:</strong> (31) 98522-8153</p>
          <p><strong>E-mail:</strong> contato@empresa.com.br</p>
        </div>
        <div>
          <p><strong>Endereço de Entrega:</strong> Rua X, 123 – Bairro Y – Cidade Z – UF</p>
        </div>
        <div>
          <p><strong>Endereço de Faturamento:</strong> Igual ao de entrega</p>
          <p><strong>Endereço de Registro:</strong> Igual ao de entrega</p>
          <p><strong>Transportadora:</strong> RAHARA</p>
        </div>
      </div>`;
    }

    // Título dinâmico
    const title = isFirst
      ? `ITENS DO ORÇAMENTO (N° 12)`
      : `ITENS DO ORÇAMENTO (N° 12) - Continuação`;

    // Monta a tabela
    const cols   = ['Código','Nome do Produto','NCM','Quantidade','Valor Unitário','Total Desconto','Valor Total'];
    const widths = ['10%','30%','12%','10%','12%','13%','13%'];
    const thead  = `<thead><tr>${cols.map((c,i)=>`<th style="width:${widths[i]}">${c}</th>`).join('')}</tr></thead>`;
    const tbody  = `<tbody>${chunk.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;

    let html = `
      ${header}
      <h3 class="font-bold text-accent-red mb-1">${title}</h3>
      <table>${thead}${tbody}</table>`;

    // Se for a última página, adiciona resumo/observações/assinatura
    if (isLast) {
      html += `
      <div class="text-sm mt-2">
        <h3 class="font-bold text-accent-red mb-1">RESUMO DE VALORES</h3>
        <table class="w-full mb-2">
          <tr><td>Desconto de Pagamento:</td><td class="text-right">R$ 189,00</td></tr>
          <tr><td>Desconto Especial:</td><td class="text-right">R$ 11,00</td></tr>
          <tr><td>Desconto Total:</td><td class="text-right">R$ 200,00</td></tr>
          <tr class="border-t"><td><strong>Valor a Pagar:</strong></td><td class="text-right"><strong>R$ 1,00</strong></td></tr>
        </table>
        <p class="font-semibold text-accent-red mb-1">OBSERVAÇÕES:</p>
        <p>- Conferir este orçamento. Caso divergência, contatar o vendedor.</p>
        <div class="mt-2">
          <p><strong>AUTORIZAÇÃO DO PEDIDO:</strong></p>
          <p>Nome do Responsável: ____________________________</p>
          <p>Assinatura: ____________________________</p>
        </div>
      </div>`;
    } else {
      // Páginas intermediárias: apenas espaço para assinatura
      html += `
      <p class="mt-2"><strong>Nome do Responsável:</strong> ____________________________</p>
      <p><strong>Assinatura:</strong> ____________________________</p>`;
    }

    createPage(html);
  });
}

window.onload = buildDocument;
