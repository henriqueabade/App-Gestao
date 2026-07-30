// GERADO AUTOMATICAMENTE — fonte única da verdade das permissões.
// Cada módulo vira uma tabela perm_<code> com uma coluna booleana por permissão.
// Para regenerar, rode o gerador em scripts/ (ver README de permissões).
/* eslint-disable */
const PERMISSIONS_CATALOG = {
  "mp": {
    "code": "mp",
    "label": "Matéria-prima",
    "page": "materia-prima",
    "table": "perm_mp",
    "configured": true,
    "actions": [
      {
        "key": "mp.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Visualizar grade de matérias-primas"
      },
      {
        "key": "mp.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Habilitar filtros e ordenação"
      },
      {
        "key": "mp.export",
        "column": "acao_export",
        "label": "Exportar lista",
        "desc": "Exportar dados visíveis (CSV/XLSX/PDF)"
      },
      {
        "key": "mp.create",
        "column": "acao_create",
        "label": "Cadastrar MP",
        "desc": "Criar novos itens de matéria-prima"
      },
      {
        "key": "mp.edit",
        "column": "acao_edit",
        "label": "Editar MP",
        "desc": "Alterar dados de matérias-primas"
      },
      {
        "key": "mp.delete",
        "column": "acao_delete",
        "label": "Excluir MP",
        "desc": "Remover itens com validações"
      },
      {
        "key": "mp.process.view",
        "column": "acao_process_view",
        "label": "Ver processos",
        "desc": "Visualizar etapas vinculadas"
      },
      {
        "key": "mp.process.create",
        "column": "acao_process_create",
        "label": "Cadastrar processo",
        "desc": "Definir novas etapas, custos e ordem"
      },
      {
        "key": "mp.process.delete",
        "column": "acao_process_delete",
        "label": "Excluir processo",
        "desc": "Remover processos cadastrados"
      },
      {
        "key": "mp.category.view",
        "column": "acao_category_view",
        "label": "Ver categorias",
        "desc": "Visualizar classificações e contagens"
      },
      {
        "key": "mp.category.create",
        "column": "acao_category_create",
        "label": "Cadastrar categoria",
        "desc": "Criar novas categorias"
      },
      {
        "key": "mp.category.edit",
        "column": "acao_category_edit",
        "label": "Editar categoria",
        "desc": "Alterar nome, descrição e ordem"
      },
      {
        "key": "mp.category.delete",
        "column": "acao_category_delete",
        "label": "Excluir categoria",
        "desc": "Remover categorias com validações"
      },
      {
        "key": "mp.unit.view",
        "column": "acao_unit_view",
        "label": "Ver unidades",
        "desc": "Listar unidades e precisões"
      },
      {
        "key": "mp.unit.create",
        "column": "acao_unit_create",
        "label": "Cadastrar unidade",
        "desc": "Criar nova unidade de medida"
      },
      {
        "key": "mp.unit.edit",
        "column": "acao_unit_edit",
        "label": "Editar unidade",
        "desc": "Alterar descrição ou sigla"
      },
      {
        "key": "mp.unit.delete",
        "column": "acao_unit_delete",
        "label": "Excluir unidade",
        "desc": "Remover unidades em desuso"
      },
      {
        "key": "mp.stock.view",
        "column": "acao_stock_view",
        "label": "Ver estoque",
        "desc": "Exibir saldo, mínimo e movimentações"
      },
      {
        "key": "mp.stock.input",
        "column": "acao_stock_input",
        "label": "Entrada de estoque",
        "desc": "Lançar compras ou ajustes positivos"
      },
      {
        "key": "mp.stock.output",
        "column": "acao_stock_output",
        "label": "Saída de estoque",
        "desc": "Registrar consumo ou baixas"
      },
      {
        "key": "mp.stock.adjust",
        "column": "acao_stock_adjust",
        "label": "Ajustar estoque",
        "desc": "Permitir acerto direto de saldo"
      },
      {
        "key": "mp.stock.infinite_toggle",
        "column": "acao_stock_infinite_toggle",
        "label": "Alternar estoque infinito",
        "desc": "Marcar itens que ignoram controle"
      }
    ],
    "columns": [
      {
        "key": "col_mp_codigo",
        "column": "col_mp_codigo",
        "label": "Código"
      },
      {
        "key": "col_mp_nome",
        "column": "col_mp_nome",
        "label": "Matéria-prima"
      },
      {
        "key": "col_mp_categoria",
        "column": "col_mp_categoria",
        "label": "Categoria"
      },
      {
        "key": "col_mp_unidade",
        "column": "col_mp_unidade",
        "label": "Unidade"
      },
      {
        "key": "col_mp_estoque_atual",
        "column": "col_mp_estoque_atual",
        "label": "Estoque atual"
      },
      {
        "key": "col_mp_estoque_min",
        "column": "col_mp_estoque_min",
        "label": "Estoque mín."
      },
      {
        "key": "col_mp_custo_medio",
        "column": "col_mp_custo_medio",
        "label": "Custo médio"
      },
      {
        "key": "col_mp_fornecedor",
        "column": "col_mp_fornecedor",
        "label": "Fornecedor"
      },
      {
        "key": "col_mp_status",
        "column": "col_mp_status",
        "label": "Status"
      },
      {
        "key": "col_mp_atualizado_em",
        "column": "col_mp_atualizado_em",
        "label": "Atualizado em"
      },
      {
        "key": "col_mov_data",
        "column": "col_mov_data",
        "label": "Data"
      },
      {
        "key": "col_mov_tipo",
        "column": "col_mov_tipo",
        "label": "Tipo"
      },
      {
        "key": "col_mov_qtd",
        "column": "col_mov_qtd",
        "label": "Quantidade"
      },
      {
        "key": "col_mov_ref",
        "column": "col_mov_ref",
        "label": "Referência"
      },
      {
        "key": "col_mov_usuario",
        "column": "col_mov_usuario",
        "label": "Usuário"
      },
      {
        "key": "col_proc_nome",
        "column": "col_proc_nome",
        "label": "Processo"
      },
      {
        "key": "col_proc_duracao",
        "column": "col_proc_duracao",
        "label": "Duração"
      },
      {
        "key": "col_proc_custo",
        "column": "col_proc_custo",
        "label": "Custo"
      },
      {
        "key": "col_proc_ordem",
        "column": "col_proc_ordem",
        "label": "Ordem"
      },
      {
        "key": "col_cat_nome",
        "column": "col_cat_nome",
        "label": "Categoria"
      },
      {
        "key": "col_cat_desc",
        "column": "col_cat_desc",
        "label": "Descrição"
      },
      {
        "key": "col_cat_itens",
        "column": "col_cat_itens",
        "label": "Itens"
      },
      {
        "key": "col_uni_sigla",
        "column": "col_uni_sigla",
        "label": "Unidade"
      },
      {
        "key": "col_uni_desc",
        "column": "col_uni_desc",
        "label": "Descrição"
      },
      {
        "key": "col_uni_precision",
        "column": "col_uni_precision",
        "label": "Precisão"
      }
    ]
  },
  "prod": {
    "code": "prod",
    "label": "Produtos",
    "page": "produtos",
    "table": "perm_prod",
    "configured": true,
    "actions": [
      {
        "key": "prod.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Exibir a grade de produtos"
      },
      {
        "key": "prod.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Campo de busca, filtros e botoes Filtrar/Limpar"
      },
      {
        "key": "prod.create",
        "column": "acao_create",
        "label": "Cadastrar produto",
        "desc": "Botao \"Novo Produto\""
      },
      {
        "key": "prod.stock.view",
        "column": "acao_stock_view",
        "label": "Ver estoque",
        "desc": "Ícone de estoque — abre \"Detalhe de Estoque\""
      },
      {
        "key": "prod.details.view",
        "column": "acao_details_view",
        "label": "Visualizar produto",
        "desc": "Ícone de olho — abre \"Visualizar Produto\""
      },
      {
        "key": "prod.edit",
        "column": "acao_edit",
        "label": "Editar produto",
        "desc": "Ícone de lápis — abre \"Editar Produto\""
      },
      {
        "key": "prod.delete",
        "column": "acao_delete",
        "label": "Excluir produto",
        "desc": "Ícone de lixeira — abre a confirmação"
      },
      {
        "key": "prod.item.add",
        "column": "acao_item_add",
        "label": "Adicionar item",
        "desc": "Botões \"+ Começar\" e \"+ Inserir\""
      },
      {
        "key": "prod.item.edit",
        "column": "acao_item_edit",
        "label": "Editar item",
        "desc": "Ícone de lápis na coluna AÇÃO da tabela de itens"
      },
      {
        "key": "prod.item.remove",
        "column": "acao_item_remove",
        "label": "Remover item",
        "desc": "Ícone de lixeira na coluna AÇÃO da tabela de itens"
      },
      {
        "key": "prod.clear",
        "column": "acao_clear",
        "label": "Limpar tudo",
        "desc": "Botão \"Limpar Tudo\""
      },
      {
        "key": "prod.percent.edit",
        "column": "acao_percent_edit",
        "label": "Editar percentagens",
        "desc": "Markup, comissão e imposto"
      },
      {
        "key": "prod.collection.create",
        "column": "acao_collection_create",
        "label": "Cadastrar coleção",
        "desc": "Botão + ao lado de Coleção"
      },
      {
        "key": "prod.collection.delete",
        "column": "acao_collection_delete",
        "label": "Excluir coleção",
        "desc": "Botão − ao lado de Coleção"
      },
      {
        "key": "prod.clone",
        "column": "acao_clone",
        "label": "Clonar produto",
        "desc": "Botão \"Clonar\""
      },
      {
        "key": "prod.registro.toggle",
        "column": "acao_registro_toggle",
        "label": "Alternar registro",
        "desc": "Chave \"Editar registro\""
      },
      {
        "key": "prod.pdf",
        "column": "acao_pdf",
        "label": "Gerar PDF",
        "desc": "Botão \"Gerar PDF\""
      },
      {
        "key": "prod.stage.insert",
        "column": "acao_stage_insert",
        "label": "Registrar processo",
        "desc": "Botão \"Registrar\" do modal de processo"
      },
      {
        "key": "prod.stage.item.add",
        "column": "acao_stage_item_add",
        "label": "Inserir item no processo",
        "desc": "Botão \"+ Inserir\""
      },
      {
        "key": "prod.stage.item.edit",
        "column": "acao_stage_item_edit",
        "label": "Editar item do processo",
        "desc": "Ícone de lápis na tabela do processo"
      },
      {
        "key": "prod.stage.item.remove",
        "column": "acao_stage_item_remove",
        "label": "Excluir item do processo",
        "desc": "Ícone de lixeira na tabela do processo"
      },
      {
        "key": "prod.stage.clear",
        "column": "acao_stage_clear",
        "label": "Limpar itens do processo",
        "desc": "Botão \"Limpar Tudo\" do modal de processo"
      },
      {
        "key": "prod.stock.input",
        "column": "acao_stock_input",
        "label": "Adicionar ao estoque",
        "desc": "Botão \"+ Registrar\" em \"Adicionar produto ao estoque\""
      },
      {
        "key": "prod.stock.adjust",
        "column": "acao_stock_adjust",
        "label": "Somar ao existente",
        "desc": "Botão \"Somar\" em \"Item já registrado\""
      },
      {
        "key": "prod.stock.lote.delete",
        "column": "acao_stock_lote_delete",
        "label": "Excluir lote de estoque",
        "desc": "Ícone de lixeira na coluna AÇÕES do \"Detalhe de Estoque\""
      }
    ],
    "columns": [
      {
        "key": "col_prod_sku",
        "column": "col_prod_sku",
        "label": "Código"
      },
      {
        "key": "col_prod_nome",
        "column": "col_prod_nome",
        "label": "Nome"
      },
      {
        "key": "col_prod_colecao",
        "column": "col_prod_colecao",
        "label": "Coleção"
      },
      {
        "key": "col_prod_preco_base",
        "column": "col_prod_preco_base",
        "label": "Preço de Venda"
      },
      {
        "key": "col_prod_margem",
        "column": "col_prod_margem",
        "label": "Margem (%)"
      },
      {
        "key": "col_prod_estoque",
        "column": "col_prod_estoque",
        "label": "Quantidade"
      },
      {
        "key": "col_ins_mp",
        "column": "col_ins_mp",
        "label": "Nome do item"
      },
      {
        "key": "col_ins_qtd",
        "column": "col_ins_qtd",
        "label": "Quantidade"
      },
      {
        "key": "col_ins_unidade",
        "column": "col_ins_unidade",
        "label": "Unidade"
      },
      {
        "key": "col_ins_custo_un",
        "column": "col_ins_custo_un",
        "label": "Valor unitário"
      },
      {
        "key": "col_ins_custo_total",
        "column": "col_ins_custo_total",
        "label": "Valor total"
      },
      {
        "key": "col_etapa_item",
        "column": "col_etapa_item",
        "label": "Item"
      },
      {
        "key": "col_etapa_qtd",
        "column": "col_etapa_qtd",
        "label": "Quantidade"
      },
      {
        "key": "col_etapa_unidade",
        "column": "col_etapa_unidade",
        "label": "Unidade"
      },
      {
        "key": "col_etapa_valor_un",
        "column": "col_etapa_valor_un",
        "label": "Valor unitário (R$)"
      },
      {
        "key": "col_etapa_valor_total",
        "column": "col_etapa_valor_total",
        "label": "Valor total (R$)"
      },
      {
        "key": "col_est_processo",
        "column": "col_est_processo",
        "label": "Processo atual"
      },
      {
        "key": "col_est_ultimo_item",
        "column": "col_est_ultimo_item",
        "label": "Último item"
      },
      {
        "key": "col_est_quantidade",
        "column": "col_est_quantidade",
        "label": "Quantidade em estoque"
      },
      {
        "key": "col_est_alterado_em",
        "column": "col_est_alterado_em",
        "label": "Última alteração"
      }
    ]
  },
  "orc": {
    "code": "orc",
    "label": "Orçamentos",
    "page": "orcamentos",
    "table": "perm_orc",
    "configured": true,
    "actions": [
      {
        "key": "orc.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Exibir lista de orçamentos"
      },
      {
        "key": "orc.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Habilitar filtros e ordenação"
      },
      {
        "key": "orc.create",
        "column": "acao_create",
        "label": "Criar orçamento",
        "desc": "Abrir novo orçamento com itens"
      },
      {
        "key": "orc.edit",
        "column": "acao_edit",
        "label": "Editar orçamento",
        "desc": "Alterar itens, preços e validade"
      },
      {
        "key": "orc.view.details",
        "column": "acao_view_details",
        "label": "Ver detalhes",
        "desc": "Acessar visão completa do orçamento"
      },
      {
        "key": "orc.item.replace",
        "column": "acao_item_replace",
        "label": "Trocar item",
        "desc": "Substituir item recalculando total"
      },
      {
        "key": "orc.convert",
        "column": "acao_convert",
        "label": "Converter em pedido",
        "desc": "Gerar pedido a partir de orçamento"
      },
      {
        "key": "orc.export",
        "column": "acao_export",
        "label": "Baixar PDF",
        "desc": "Gerar e baixar o PDF do orçamento"
      }
    ],
    "columns": [
      {
        "key": "col_orc_num",
        "column": "col_orc_num",
        "label": "Nº orçamento"
      },
      {
        "key": "col_orc_cliente",
        "column": "col_orc_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_orc_vendedor",
        "column": "col_orc_vendedor",
        "label": "Vendedor"
      },
      {
        "key": "col_orc_data",
        "column": "col_orc_data",
        "label": "Data"
      },
      {
        "key": "col_orc_validade",
        "column": "col_orc_validade",
        "label": "Validade"
      },
      {
        "key": "col_orc_itens",
        "column": "col_orc_itens",
        "label": "Itens"
      },
      {
        "key": "col_orc_subtotal",
        "column": "col_orc_subtotal",
        "label": "Subtotal"
      },
      {
        "key": "col_orc_desc",
        "column": "col_orc_desc",
        "label": "Descontos"
      },
      {
        "key": "col_orc_frete_outros",
        "column": "col_orc_frete_outros",
        "label": "Frete/outros"
      },
      {
        "key": "col_orc_total",
        "column": "col_orc_total",
        "label": "Total"
      },
      {
        "key": "col_orc_status",
        "column": "col_orc_status",
        "label": "Status"
      },
      {
        "key": "col_orc_it_nome",
        "column": "col_orc_it_nome",
        "label": "Item"
      },
      {
        "key": "col_orc_it_sku",
        "column": "col_orc_it_sku",
        "label": "SKU"
      },
      {
        "key": "col_orc_it_qtd",
        "column": "col_orc_it_qtd",
        "label": "Qtd."
      },
      {
        "key": "col_orc_it_preco",
        "column": "col_orc_it_preco",
        "label": "Preço"
      },
      {
        "key": "col_orc_it_desc",
        "column": "col_orc_it_desc",
        "label": "Desc."
      },
      {
        "key": "col_orc_it_subtotal",
        "column": "col_orc_it_subtotal",
        "label": "Subtotal"
      },
      {
        "key": "col_orc_it_obs",
        "column": "col_orc_it_obs",
        "label": "Observações"
      },
      {
        "key": "col_orc_cond_pagto",
        "column": "col_orc_cond_pagto",
        "label": "Pagamento"
      },
      {
        "key": "col_orc_cond_parc",
        "column": "col_orc_cond_parc",
        "label": "Parcelas"
      },
      {
        "key": "col_orc_cond_prazo",
        "column": "col_orc_cond_prazo",
        "label": "Prazo"
      },
      {
        "key": "col_orc_cond_validade",
        "column": "col_orc_cond_validade",
        "label": "Validade"
      }
    ]
  },
  "ped": {
    "code": "ped",
    "label": "Pedidos",
    "page": "pedidos",
    "table": "perm_ped",
    "configured": true,
    "actions": [
      {
        "key": "ped.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Exibir pedidos com status"
      },
      {
        "key": "ped.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Habilitar filtros e ordenação"
      },
      {
        "key": "ped.view.details",
        "column": "acao_view_details",
        "label": "Ver detalhes",
        "desc": "Abrir visão completa do pedido"
      },
      {
        "key": "ped.cancel",
        "column": "acao_cancel",
        "label": "Cancelar pedido",
        "desc": "Cancelar com regras de estoque/financeiro"
      },
      {
        "key": "ped.stock.deduct",
        "column": "acao_stock_deduct",
        "label": "Abater estoque",
        "desc": "Baixar estoque dos itens"
      },
      {
        "key": "ped.stock.restore_on_cancel",
        "column": "acao_stock_restore_on_cancel",
        "label": "Restaurar estoque ao cancelar",
        "desc": "Reverter baixas quando cancelado"
      },
      {
        "key": "ped.status.confirm",
        "column": "acao_status_confirm",
        "label": "Confirmar pedido",
        "desc": "Marcar pedido como confirmado"
      },
      {
        "key": "ped.status.invoice",
        "column": "acao_status_invoice",
        "label": "Faturar pedido",
        "desc": "Gerar faturamento"
      },
      {
        "key": "ped.status.ship",
        "column": "acao_status_ship",
        "label": "Despachar pedido",
        "desc": "Registrar expedição e rastreio"
      },
      {
        "key": "ped.status.deliver",
        "column": "acao_status_deliver",
        "label": "Dar como entregue",
        "desc": "Concluir entrega com registro"
      },
      {
        "key": "ped.export",
        "column": "acao_export",
        "label": "Baixar PDF",
        "desc": "Gerar e baixar o PDF do pedido"
      },
      {
        "key": "ped.report",
        "column": "acao_report",
        "label": "Ver relatório",
        "desc": "Abrir o relatório do pedido"
      }
    ],
    "columns": [
      {
        "key": "col_ped_num",
        "column": "col_ped_num",
        "label": "Nº pedido"
      },
      {
        "key": "col_ped_cliente",
        "column": "col_ped_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_ped_vendedor",
        "column": "col_ped_vendedor",
        "label": "Vendedor"
      },
      {
        "key": "col_ped_data",
        "column": "col_ped_data",
        "label": "Data"
      },
      {
        "key": "col_ped_entrega",
        "column": "col_ped_entrega",
        "label": "Entrega"
      },
      {
        "key": "col_ped_itens",
        "column": "col_ped_itens",
        "label": "Itens"
      },
      {
        "key": "col_ped_total",
        "column": "col_ped_total",
        "label": "Total"
      },
      {
        "key": "col_ped_abate_estoque",
        "column": "col_ped_abate_estoque",
        "label": "Abate estoque"
      },
      {
        "key": "col_ped_status",
        "column": "col_ped_status",
        "label": "Status"
      },
      {
        "key": "col_ped_condicao",
        "column": "col_ped_condicao",
        "label": "Condição"
      },
      {
        "key": "col_ped_origem",
        "column": "col_ped_origem",
        "label": "Origem"
      },
      {
        "key": "col_ped_it_nome",
        "column": "col_ped_it_nome",
        "label": "Item"
      },
      {
        "key": "col_ped_it_sku",
        "column": "col_ped_it_sku",
        "label": "SKU"
      },
      {
        "key": "col_ped_it_qtd",
        "column": "col_ped_it_qtd",
        "label": "Qtd."
      },
      {
        "key": "col_ped_it_preco",
        "column": "col_ped_it_preco",
        "label": "Preço"
      },
      {
        "key": "col_ped_it_desc",
        "column": "col_ped_it_desc",
        "label": "Desc."
      },
      {
        "key": "col_ped_it_subtotal",
        "column": "col_ped_it_subtotal",
        "label": "Subtotal"
      },
      {
        "key": "col_ped_it_situacao",
        "column": "col_ped_it_situacao",
        "label": "Situação"
      },
      {
        "key": "col_log_transportadora",
        "column": "col_log_transportadora",
        "label": "Transportadora"
      },
      {
        "key": "col_log_cod_rastreio",
        "column": "col_log_cod_rastreio",
        "label": "Código rastreio"
      },
      {
        "key": "col_log_frete_valor",
        "column": "col_log_frete_valor",
        "label": "Frete"
      },
      {
        "key": "col_log_data_envio",
        "column": "col_log_data_envio",
        "label": "Enviado em"
      },
      {
        "key": "col_log_data_entrega",
        "column": "col_log_data_entrega",
        "label": "Entregue em"
      }
    ]
  },
  "cli": {
    "code": "cli",
    "label": "Clientes",
    "page": "clientes",
    "table": "perm_cli",
    "configured": true,
    "actions": [
      {
        "key": "cli.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Exibir grade de clientes"
      },
      {
        "key": "cli.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Pesquisa e ordenação"
      },
      {
        "key": "cli.details.view",
        "column": "acao_details_view",
        "label": "Ver detalhes",
        "desc": "Abrir cadastro completo"
      },
      {
        "key": "cli.create",
        "column": "acao_create",
        "label": "Cadastrar cliente",
        "desc": "Criar novo registro"
      },
      {
        "key": "cli.edit",
        "column": "acao_edit",
        "label": "Editar cliente",
        "desc": "Alterar dados e status"
      },
      {
        "key": "cli.delete",
        "column": "acao_delete",
        "label": "Excluir cliente",
        "desc": "Remover cliente com validações"
      }
    ],
    "columns": [
      {
        "key": "col_cli_nome_fantasia",
        "column": "col_cli_nome_fantasia",
        "label": "Nome fantasia"
      },
      {
        "key": "col_cli_razao_social",
        "column": "col_cli_razao_social",
        "label": "Razão social"
      },
      {
        "key": "col_cli_cnpj",
        "column": "col_cli_cnpj",
        "label": "CNPJ"
      },
      {
        "key": "col_cli_comprador",
        "column": "col_cli_comprador",
        "label": "Comprador/contato"
      },
      {
        "key": "col_cli_tel",
        "column": "col_cli_tel",
        "label": "Telefone"
      },
      {
        "key": "col_cli_email",
        "column": "col_cli_email",
        "label": "E-mail"
      },
      {
        "key": "col_cli_cidade_uf",
        "column": "col_cli_cidade_uf",
        "label": "Cidade/UF"
      },
      {
        "key": "col_cli_transportadora",
        "column": "col_cli_transportadora",
        "label": "Transportadora"
      },
      {
        "key": "col_cli_status",
        "column": "col_cli_status",
        "label": "Status"
      },
      {
        "key": "col_cli_owner",
        "column": "col_cli_owner",
        "label": "Dono"
      },
      {
        "key": "col_end_tipo",
        "column": "col_end_tipo",
        "label": "Tipo"
      },
      {
        "key": "col_end_logradouro",
        "column": "col_end_logradouro",
        "label": "Logradouro"
      },
      {
        "key": "col_end_numero",
        "column": "col_end_numero",
        "label": "Nº"
      },
      {
        "key": "col_end_complemento",
        "column": "col_end_complemento",
        "label": "Compl."
      },
      {
        "key": "col_end_bairro",
        "column": "col_end_bairro",
        "label": "Bairro"
      },
      {
        "key": "col_end_cidade",
        "column": "col_end_cidade",
        "label": "Cidade"
      },
      {
        "key": "col_end_uf",
        "column": "col_end_uf",
        "label": "UF"
      },
      {
        "key": "col_end_cep",
        "column": "col_end_cep",
        "label": "CEP"
      },
      {
        "key": "col_ctt_nome",
        "column": "col_ctt_nome",
        "label": "Contato"
      },
      {
        "key": "col_ctt_cargo",
        "column": "col_ctt_cargo",
        "label": "Cargo"
      },
      {
        "key": "col_ctt_tel",
        "column": "col_ctt_tel",
        "label": "Telefone"
      },
      {
        "key": "col_ctt_email",
        "column": "col_ctt_email",
        "label": "E-mail"
      },
      {
        "key": "col_ctt_tags",
        "column": "col_ctt_tags",
        "label": "Tags"
      },
      {
        "key": "col_ctt_status",
        "column": "col_ctt_status",
        "label": "Status"
      },
      {
        "key": "col_ctt_ult_interacao",
        "column": "col_ctt_ult_interacao",
        "label": "Últ. interação"
      }
    ]
  },
  "pros": {
    "code": "pros",
    "label": "Prospecções",
    "page": "prospeccoes",
    "table": "perm_pros",
    "configured": true,
    "actions": [
      {
        "key": "pros.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Exibir pipeline/lista"
      },
      {
        "key": "pros.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Filtros por etapa, origem, responsável"
      },
      {
        "key": "pros.details.view",
        "column": "acao_details_view",
        "label": "Ver detalhes",
        "desc": "Acessar histórico e próximos passos"
      },
      {
        "key": "pros.create",
        "column": "acao_create",
        "label": "Cadastrar prospecção",
        "desc": "Criar novo lead/oportunidade"
      },
      {
        "key": "pros.edit",
        "column": "acao_edit",
        "label": "Editar prospecção",
        "desc": "Alterar dados, valor e probabilidade"
      },
      {
        "key": "pros.delete",
        "column": "acao_delete",
        "label": "Excluir prospecção",
        "desc": "Remover oportunidade com checagens"
      },
      {
        "key": "pros.stage.update",
        "column": "acao_stage_update",
        "label": "Atualizar etapa",
        "desc": "Mover prospecção no funil"
      },
      {
        "key": "pros.next.step",
        "column": "acao_next_step",
        "label": "Definir próximo passo",
        "desc": "Agendar próxima ação"
      }
    ],
    "columns": [
      {
        "key": "col_pros_id",
        "column": "col_pros_id",
        "label": "ID"
      },
      {
        "key": "col_pros_entidade",
        "column": "col_pros_entidade",
        "label": "Entidade"
      },
      {
        "key": "col_pros_origem",
        "column": "col_pros_origem",
        "label": "Origem"
      },
      {
        "key": "col_pros_etapa",
        "column": "col_pros_etapa",
        "label": "Etapa"
      },
      {
        "key": "col_pros_valor",
        "column": "col_pros_valor",
        "label": "Valor"
      },
      {
        "key": "col_pros_prob",
        "column": "col_pros_prob",
        "label": "Prob. (%)"
      },
      {
        "key": "col_pros_owner",
        "column": "col_pros_owner",
        "label": "Dono"
      },
      {
        "key": "col_pros_proximo_passo",
        "column": "col_pros_proximo_passo",
        "label": "Próx. passo"
      },
      {
        "key": "col_pros_proximo_passo_data",
        "column": "col_pros_proximo_passo_data",
        "label": "Para quando"
      },
      {
        "key": "col_pros_atualizado_em",
        "column": "col_pros_atualizado_em",
        "label": "Atualizado em"
      },
      {
        "key": "col_hist_data",
        "column": "col_hist_data",
        "label": "Data"
      },
      {
        "key": "col_hist_tipo",
        "column": "col_hist_tipo",
        "label": "Tipo"
      },
      {
        "key": "col_hist_resumo",
        "column": "col_hist_resumo",
        "label": "Resumo"
      },
      {
        "key": "col_hist_resp",
        "column": "col_hist_resp",
        "label": "Responsável"
      }
    ]
  },
  "ctt": {
    "code": "ctt",
    "label": "Contatos",
    "page": "contatos",
    "table": "perm_ctt",
    "configured": true,
    "actions": [
      {
        "key": "ctt.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Exibir lista de contatos"
      },
      {
        "key": "ctt.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Pesquisa por nome, cargo, tags"
      },
      {
        "key": "ctt.details.view",
        "column": "acao_details_view",
        "label": "Ver detalhes",
        "desc": "Mostrar dados completos e vínculos"
      },
      {
        "key": "ctt.create",
        "column": "acao_create",
        "label": "Cadastrar contato",
        "desc": "Criar novo contato"
      },
      {
        "key": "ctt.edit",
        "column": "acao_edit",
        "label": "Editar contato",
        "desc": "Alterar dados e status"
      },
      {
        "key": "ctt.link.client",
        "column": "acao_link_client",
        "label": "Vincular a cliente",
        "desc": "Relacionar contato a cliente"
      },
      {
        "key": "ctt.unlink.client",
        "column": "acao_unlink_client",
        "label": "Desvincular de cliente",
        "desc": "Remover vínculo com cliente"
      },
      {
        "key": "ctt.log.add",
        "column": "acao_log_add",
        "label": "Registrar interação",
        "desc": "Adicionar log de interação"
      },
      {
        "key": "ctt.log.view",
        "column": "acao_log_view",
        "label": "Ver interações",
        "desc": "Listar histórico do contato"
      },
      {
        "key": "ctt.status.update",
        "column": "acao_status_update",
        "label": "Atualizar status",
        "desc": "Definir ativo/inativo/qualificação"
      },
      {
        "key": "ctt.tag.manage",
        "column": "acao_tag_manage",
        "label": "Gerenciar tags",
        "desc": "Criar ou atribuir tags"
      },
      {
        "key": "ctt.delete",
        "column": "acao_delete",
        "label": "Excluir contato",
        "desc": "Remover contato com validações"
      }
    ],
    "columns": [
      {
        "key": "col_ctt_nome",
        "column": "col_ctt_nome",
        "label": "Contato"
      },
      {
        "key": "col_ctt_cliente",
        "column": "col_ctt_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_ctt_cargo",
        "column": "col_ctt_cargo",
        "label": "Cargo"
      },
      {
        "key": "col_ctt_tel",
        "column": "col_ctt_tel",
        "label": "Telefone"
      },
      {
        "key": "col_ctt_email",
        "column": "col_ctt_email",
        "label": "E-mail"
      },
      {
        "key": "col_ctt_origem",
        "column": "col_ctt_origem",
        "label": "Origem"
      },
      {
        "key": "col_ctt_tags",
        "column": "col_ctt_tags",
        "label": "Tags"
      },
      {
        "key": "col_ctt_status",
        "column": "col_ctt_status",
        "label": "Status"
      },
      {
        "key": "col_ctt_ult_interacao",
        "column": "col_ctt_ult_interacao",
        "label": "Últ. interação"
      },
      {
        "key": "col_ctt_owner",
        "column": "col_ctt_owner",
        "label": "Dono"
      },
      {
        "key": "col_log_data",
        "column": "col_log_data",
        "label": "Data"
      },
      {
        "key": "col_log_canal",
        "column": "col_log_canal",
        "label": "Canal"
      },
      {
        "key": "col_log_assunto",
        "column": "col_log_assunto",
        "label": "Assunto"
      },
      {
        "key": "col_log_detalhes",
        "column": "col_log_detalhes",
        "label": "Detalhes"
      },
      {
        "key": "col_log_resp",
        "column": "col_log_resp",
        "label": "Responsável"
      }
    ]
  },
  "rel": {
    "code": "rel",
    "label": "Relatórios",
    "page": "relatorios",
    "table": "perm_rel",
    "configured": true,
    "actions": [
      {
        "key": "rel.view",
        "column": "acao_view",
        "label": "Ver módulo",
        "desc": "Acessar área de relatórios"
      },
      {
        "key": "rel.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Selecionar período e filtros"
      },
      {
        "key": "rel.run",
        "column": "acao_run",
        "label": "Rodar relatório",
        "desc": "Executar consultas e gerar dados"
      },
      {
        "key": "rel.export.csv",
        "column": "acao_export_csv",
        "label": "Exportar CSV",
        "desc": "Exportar dados em CSV"
      },
      {
        "key": "rel.export.xlsx",
        "column": "acao_export_xlsx",
        "label": "Exportar XLSX",
        "desc": "Exportar dados em XLSX"
      },
      {
        "key": "rel.export.pdf",
        "column": "acao_export_pdf",
        "label": "Exportar PDF",
        "desc": "Gerar PDF formatado"
      },
      {
        "key": "rel.preset.save",
        "column": "acao_preset_save",
        "label": "Salvar preset",
        "desc": "Salvar conjunto de filtros/colunas"
      },
      {
        "key": "rel.preset.load",
        "column": "acao_preset_load",
        "label": "Carregar preset",
        "desc": "Carregar preset salvo"
      },
      {
        "key": "rel.preset.manage",
        "column": "acao_preset_manage",
        "label": "Gerenciar presets",
        "desc": "Renomear, compartilhar ou excluir presets"
      },
      {
        "key": "rel.share.link",
        "column": "acao_share_link",
        "label": "Gerar link compartilhável",
        "desc": "Criar link protegido para visualização"
      },
      {
        "key": "rel.share.send",
        "column": "acao_share_send",
        "label": "Enviar relatório",
        "desc": "Disparar por e-mail/integração"
      }
    ],
    "columns": [
      {
        "key": "col_rel_estq_nome",
        "column": "col_rel_estq_nome",
        "label": "Nome"
      },
      {
        "key": "col_rel_estq_categoria",
        "column": "col_rel_estq_categoria",
        "label": "Categoria"
      },
      {
        "key": "col_rel_estq_unidade",
        "column": "col_rel_estq_unidade",
        "label": "Unidade"
      },
      {
        "key": "col_rel_estq_qtd",
        "column": "col_rel_estq_qtd",
        "label": "Quantidade"
      },
      {
        "key": "col_rel_estq_preco",
        "column": "col_rel_estq_preco",
        "label": "Preço"
      },
      {
        "key": "col_rel_estq_processo",
        "column": "col_rel_estq_processo",
        "label": "Processo"
      },
      {
        "key": "col_rel_estq_status",
        "column": "col_rel_estq_status",
        "label": "Status"
      },
      {
        "key": "col_rel_prod_codigo",
        "column": "col_rel_prod_codigo",
        "label": "Código"
      },
      {
        "key": "col_rel_prod_nome",
        "column": "col_rel_prod_nome",
        "label": "Nome"
      },
      {
        "key": "col_rel_prod_colecao",
        "column": "col_rel_prod_colecao",
        "label": "Coleção"
      },
      {
        "key": "col_rel_prod_preco_venda",
        "column": "col_rel_prod_preco_venda",
        "label": "Preço de Venda"
      },
      {
        "key": "col_rel_prod_margem",
        "column": "col_rel_prod_margem",
        "label": "Margem (%)"
      },
      {
        "key": "col_rel_prod_qtd",
        "column": "col_rel_prod_qtd",
        "label": "Quantidade"
      },
      {
        "key": "col_rel_prod_status",
        "column": "col_rel_prod_status",
        "label": "Status"
      },
      {
        "key": "col_rel_cli_nome",
        "column": "col_rel_cli_nome",
        "label": "Nome"
      },
      {
        "key": "col_rel_cli_cnpj",
        "column": "col_rel_cli_cnpj",
        "label": "CNPJ"
      },
      {
        "key": "col_rel_cli_pais",
        "column": "col_rel_cli_pais",
        "label": "País"
      },
      {
        "key": "col_rel_cli_estado",
        "column": "col_rel_cli_estado",
        "label": "Estado"
      },
      {
        "key": "col_rel_cli_status",
        "column": "col_rel_cli_status",
        "label": "Status"
      },
      {
        "key": "col_rel_cli_dono",
        "column": "col_rel_cli_dono",
        "label": "Dono"
      },
      {
        "key": "col_rel_ctt_contato",
        "column": "col_rel_ctt_contato",
        "label": "Contato"
      },
      {
        "key": "col_rel_ctt_tipo",
        "column": "col_rel_ctt_tipo",
        "label": "Tipo"
      },
      {
        "key": "col_rel_ctt_empresa",
        "column": "col_rel_ctt_empresa",
        "label": "Empresa"
      },
      {
        "key": "col_rel_ctt_celular",
        "column": "col_rel_ctt_celular",
        "label": "Celular"
      },
      {
        "key": "col_rel_ctt_telefone",
        "column": "col_rel_ctt_telefone",
        "label": "Telefone"
      },
      {
        "key": "col_rel_ctt_email",
        "column": "col_rel_ctt_email",
        "label": "E-mail"
      },
      {
        "key": "col_rel_pros_nome",
        "column": "col_rel_pros_nome",
        "label": "Nome do Lead"
      },
      {
        "key": "col_rel_pros_email",
        "column": "col_rel_pros_email",
        "label": "E-mail"
      },
      {
        "key": "col_rel_pros_status",
        "column": "col_rel_pros_status",
        "label": "Status"
      },
      {
        "key": "col_rel_pros_responsavel",
        "column": "col_rel_pros_responsavel",
        "label": "Responsável"
      },
      {
        "key": "col_rel_orc_codigo",
        "column": "col_rel_orc_codigo",
        "label": "Código"
      },
      {
        "key": "col_rel_orc_cliente",
        "column": "col_rel_orc_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_rel_orc_data",
        "column": "col_rel_orc_data",
        "label": "Data"
      },
      {
        "key": "col_rel_orc_valor",
        "column": "col_rel_orc_valor",
        "label": "Valor Total"
      },
      {
        "key": "col_rel_orc_condicao",
        "column": "col_rel_orc_condicao",
        "label": "Condição"
      },
      {
        "key": "col_rel_orc_status",
        "column": "col_rel_orc_status",
        "label": "Status"
      },
      {
        "key": "col_rel_ped_codigo",
        "column": "col_rel_ped_codigo",
        "label": "Código"
      },
      {
        "key": "col_rel_ped_cliente",
        "column": "col_rel_ped_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_rel_ped_data",
        "column": "col_rel_ped_data",
        "label": "Data"
      },
      {
        "key": "col_rel_ped_valor",
        "column": "col_rel_ped_valor",
        "label": "Valor Total"
      },
      {
        "key": "col_rel_ped_condicao",
        "column": "col_rel_ped_condicao",
        "label": "Condição"
      },
      {
        "key": "col_rel_ped_status",
        "column": "col_rel_ped_status",
        "label": "Status"
      },
      {
        "key": "col_rel_usr_avatar",
        "column": "col_rel_usr_avatar",
        "label": "Avatar"
      },
      {
        "key": "col_rel_usr_nome",
        "column": "col_rel_usr_nome",
        "label": "Nome"
      },
      {
        "key": "col_rel_usr_email",
        "column": "col_rel_usr_email",
        "label": "E-mail"
      },
      {
        "key": "col_rel_usr_perfil",
        "column": "col_rel_usr_perfil",
        "label": "Perfil"
      },
      {
        "key": "col_rel_usr_situacao",
        "column": "col_rel_usr_situacao",
        "label": "Situação"
      },
      {
        "key": "col_rel_usr_status",
        "column": "col_rel_usr_status",
        "label": "Status"
      }
    ]
  },
  "tarefas": {
    "code": "tarefas",
    "label": "Tarefas",
    "page": "tarefas",
    "table": "perm_tarefas",
    "configured": true,
    "actions": [
      {
        "key": "tarefas.view",
        "column": "acao_view",
        "label": "Ver tarefas/agenda",
        "desc": "Mostrar lista/kanban/calendário"
      },
      {
        "key": "tarefas.create",
        "column": "acao_create",
        "label": "Criar tarefa",
        "desc": "Registrar nova tarefa"
      },
      {
        "key": "tarefas.edit",
        "column": "acao_edit",
        "label": "Editar tarefa",
        "desc": "Alterar título, prazo ou responsável"
      },
      {
        "key": "tarefas.delete",
        "column": "acao_delete",
        "label": "Excluir tarefa",
        "desc": "Remover tarefa com auditoria"
      },
      {
        "key": "tarefas.assign",
        "column": "acao_assign",
        "label": "Atribuir tarefa",
        "desc": "Definir responsável ou participantes"
      },
      {
        "key": "tarefas.calendar.view",
        "column": "acao_calendar_view",
        "label": "Ver calendário",
        "desc": "Abrir visão de calendário"
      }
    ],
    "columns": [
      {
        "key": "col_tsk_titulo",
        "column": "col_tsk_titulo",
        "label": "Título"
      },
      {
        "key": "col_tsk_resp",
        "column": "col_tsk_resp",
        "label": "Responsável"
      },
      {
        "key": "col_tsk_prazo",
        "column": "col_tsk_prazo",
        "label": "Prazo"
      },
      {
        "key": "col_tsk_status",
        "column": "col_tsk_status",
        "label": "Status"
      },
      {
        "key": "col_tsk_prioridade",
        "column": "col_tsk_prioridade",
        "label": "Prioridade"
      },
      {
        "key": "col_evt_titulo",
        "column": "col_evt_titulo",
        "label": "Evento"
      },
      {
        "key": "col_evt_inicio",
        "column": "col_evt_inicio",
        "label": "Início"
      },
      {
        "key": "col_evt_fim",
        "column": "col_evt_fim",
        "label": "Fim"
      },
      {
        "key": "col_evt_local",
        "column": "col_evt_local",
        "label": "Local"
      },
      {
        "key": "col_evt_participantes",
        "column": "col_evt_participantes",
        "label": "Participantes"
      },
      {
        "key": "col_evt_status",
        "column": "col_evt_status",
        "label": "Status"
      }
    ]
  },
  "cfg": {
    "code": "cfg",
    "label": "Configurações",
    "page": "configuracoes",
    "table": "perm_cfg",
    "configured": true,
    "actions": [
      {
        "key": "cfg.view",
        "column": "acao_view",
        "label": "Ver configurações",
        "desc": "Acessar painel de configurações"
      },
      {
        "key": "cfg.theme.edit",
        "column": "acao_theme_edit",
        "label": "Editar tema",
        "desc": "Alterar identidade visual"
      },
      {
        "key": "cfg.integrations.edit",
        "column": "acao_integrations_edit",
        "label": "Editar integrações",
        "desc": "Configurar chaves e webhooks"
      },
      {
        "key": "cfg.prefs.edit",
        "column": "acao_prefs_edit",
        "label": "Editar preferências gerais",
        "desc": "Ajustar parâmetros globais"
      },
      {
        "key": "cfg.roles.view",
        "column": "acao_roles_view",
        "label": "Ver papéis/perfis",
        "desc": "Listar papéis e acessos"
      },
      {
        "key": "cfg.roles.edit",
        "column": "acao_roles_edit",
        "label": "Editar papéis/perfis",
        "desc": "Criar/editar/remover papéis"
      }
    ],
    "columns": [
      {
        "key": "col_role_code",
        "column": "col_role_code",
        "label": "Código"
      },
      {
        "key": "col_role_name",
        "column": "col_role_name",
        "label": "Nome"
      },
      {
        "key": "col_role_desc",
        "column": "col_role_desc",
        "label": "Descrição"
      },
      {
        "key": "col_role_modulos",
        "column": "col_role_modulos",
        "label": "Módulos"
      },
      {
        "key": "col_role_features",
        "column": "col_role_features",
        "label": "Ações"
      },
      {
        "key": "col_int_nome",
        "column": "col_int_nome",
        "label": "Integração"
      },
      {
        "key": "col_int_status",
        "column": "col_int_status",
        "label": "Status"
      },
      {
        "key": "col_int_ult_sync",
        "column": "col_int_ult_sync",
        "label": "Últ. sync"
      }
    ]
  },
  "dashboard": {
    "code": "dashboard",
    "label": "Dashboard",
    "page": "dashboard",
    "table": "perm_dashboard",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "calendario": {
    "code": "calendario",
    "label": "Calendário",
    "page": "calendario",
    "table": "perm_calendario",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "lam_clientes": {
    "code": "lam_clientes",
    "label": "Laminação · Clientes",
    "page": "laminacao-clientes",
    "table": "perm_lam_clientes",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "lam_servicos": {
    "code": "lam_servicos",
    "label": "Laminação · Serviços",
    "page": "laminacao-servicos",
    "table": "perm_lam_servicos",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "lam_precificacao": {
    "code": "lam_precificacao",
    "label": "Laminação · Precificação",
    "page": "laminacao-precificacao",
    "table": "perm_lam_precificacao",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "lam_relatorios": {
    "code": "lam_relatorios",
    "label": "Laminação · Relatórios",
    "page": "laminacao-relatorios",
    "table": "perm_lam_relatorios",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "ia": {
    "code": "ia",
    "label": "IA",
    "page": "ia",
    "table": "perm_ia",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "usuarios": {
    "code": "usuarios",
    "label": "Usuários",
    "page": "usuarios",
    "table": "perm_usuarios",
    "configured": false,
    "actions": [],
    "columns": []
  },
  "financeiro": {
    "code": "financeiro",
    "label": "Financeiro",
    "page": "financeiro",
    "table": "perm_financeiro",
    "configured": false,
    "actions": [],
    "columns": []
  }
};

const MODULE_CODES = Object.keys(PERMISSIONS_CATALOG);

function getModule(code) {
  return PERMISSIONS_CATALOG[code] || null;
}

// "mp.view" -> { module:'mp', column:'acao_view', type:'action' }
function resolvePermissionKey(key) {
  if (!key) return null;
  for (const mod of Object.values(PERMISSIONS_CATALOG)) {
    const a = mod.actions.find(x => x.key === key);
    if (a) return { module: mod.code, table: mod.table, column: a.column, type: 'action' };
    const c = mod.columns.find(x => x.key === key);
    if (c) return { module: mod.code, table: mod.table, column: c.column, type: 'column' };
  }
  return null;
}

module.exports = { PERMISSIONS_CATALOG, MODULE_CODES, getModule, resolvePermissionKey };
