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
        "desc": "Exibir a grade de insumos"
      },
      {
        "key": "mp.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Busca, filtros de processo/categoria, \"0 Estoque\" e botões Filtrar/Limpar"
      },
      {
        "key": "mp.create",
        "column": "acao_create",
        "label": "Cadastrar insumo",
        "desc": "Botão \"Novo Insumo\""
      },
      {
        "key": "mp.totals.view",
        "column": "acao_totals_view",
        "label": "Ver totais por tipo",
        "desc": "Painel \"Totais por Tipo\" (Infinitos / Acabando)"
      },
      {
        "key": "mp.movimentos.view",
        "column": "acao_movimentos_view",
        "label": "Ver auditoria do insumo",
        "desc": "Ícone de relatório — abre o histórico de movimentações do insumo"
      },
      {
        "key": "mp.edit",
        "column": "acao_edit",
        "label": "Editar insumo",
        "desc": "Ícone de lápis — abre \"Editar Insumo\""
      },
      {
        "key": "mp.delete",
        "column": "acao_delete",
        "label": "Excluir insumo",
        "desc": "Ícone de lixeira e botão \"Excluir Insumo\""
      },
      {
        "key": "mp.stock.edit",
        "column": "acao_stock_edit",
        "label": "Editar quantidade em estoque",
        "desc": "Campo \"Quantidade\" do insumo"
      },
      {
        "key": "mp.stock.infinite_toggle",
        "column": "acao_stock_infinite_toggle",
        "label": "Alternar estoque infinito",
        "desc": "Chave \"Estoque infinito\" (só em Editar)"
      },
      {
        "key": "mp.category.view",
        "column": "acao_category_view",
        "label": "Selecionar categoria",
        "desc": "Seletor \"Categoria\""
      },
      {
        "key": "mp.category.create",
        "column": "acao_category_create",
        "label": "Cadastrar categoria",
        "desc": "Botão + ao lado de Categoria"
      },
      {
        "key": "mp.category.delete",
        "column": "acao_category_delete",
        "label": "Excluir categoria",
        "desc": "Botão − ao lado de Categoria"
      },
      {
        "key": "mp.unit.view",
        "column": "acao_unit_view",
        "label": "Selecionar unidade",
        "desc": "Seletor \"Unidade\""
      },
      {
        "key": "mp.unit.create",
        "column": "acao_unit_create",
        "label": "Cadastrar unidade",
        "desc": "Botão + ao lado de Unidade"
      },
      {
        "key": "mp.unit.delete",
        "column": "acao_unit_delete",
        "label": "Excluir unidade",
        "desc": "Botão − ao lado de Unidade"
      },
      {
        "key": "mp.process.view",
        "column": "acao_process_view",
        "label": "Selecionar processo",
        "desc": "Seletor \"Processo\""
      },
      {
        "key": "mp.process.create",
        "column": "acao_process_create",
        "label": "Cadastrar processo",
        "desc": "Botão + ao lado de Processo"
      },
      {
        "key": "mp.process.delete",
        "column": "acao_process_delete",
        "label": "Excluir processo",
        "desc": "Botão − ao lado de Processo"
      },
      {
        "key": "mp.process.order",
        "column": "acao_process_order",
        "label": "Resolver ordem duplicada",
        "desc": "Botões \"Trocar\" e \"Última\" do aviso de ordem"
      }
    ],
    "columns": [
      {
        "key": "col_mp_nome",
        "column": "col_mp_nome",
        "label": "Nome"
      },
      {
        "key": "col_mp_estoque_atual",
        "column": "col_mp_estoque_atual",
        "label": "Quantidade"
      },
      {
        "key": "col_mp_unidade",
        "column": "col_mp_unidade",
        "label": "Unidade"
      },
      {
        "key": "col_mp_custo_medio",
        "column": "col_mp_custo_medio",
        "label": "Preço Unitário"
      },
      {
        "key": "col_mp_campo_descricao",
        "column": "col_mp_campo_descricao",
        "label": "Descrição"
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
        "key": "prod.movimentos.view",
        "column": "acao_movimentos_view",
        "label": "Ver movimentações",
        "desc": "Ícone de relatório — abre o histórico de estoque da peça"
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
      },
      {
        "key": "prod.tabela.view",
        "column": "acao_tabela_view",
        "label": "Ver preço de tabela",
        "desc": "Ícone de moeda — alterna a coluna entre Preço Tabela e Preço de Custo"
      },
      {
        "key": "prod.tabela.update",
        "column": "acao_tabela_update",
        "label": "Atualizar tabela fixa",
        "desc": "Opção \"Atualizar Tabela Fixa\" ao salvar o produto — repassa o preço aos orçamentos em aberto"
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
        "key": "col_prod_preco_tabela",
        "column": "col_prod_preco_tabela",
        "label": "Preço Tabela"
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
        "desc": "Exibir a grade de orçamentos"
      },
      {
        "key": "orc.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Filtros de status, período, dono e cliente + Filtrar/Limpar"
      },
      {
        "key": "orc.create",
        "column": "acao_create",
        "label": "Criar orçamento",
        "desc": "Botão \"Novo Orçamento\""
      },
      {
        "key": "orc.view.details",
        "column": "acao_view_details",
        "label": "Visualizar orçamento",
        "desc": "Ícone de olho — abre \"Visualizar Orçamento\""
      },
      {
        "key": "orc.edit",
        "column": "acao_edit",
        "label": "Editar orçamento",
        "desc": "Ícone de lápis — abre \"Editar Orçamento\""
      },
      {
        "key": "orc.convert",
        "column": "acao_convert",
        "label": "Converter em pedido",
        "desc": "Ícone de conversão da linha e botão \"Converter em Pedido\""
      },
      {
        "key": "orc.delete",
        "column": "acao_delete",
        "label": "Excluir orçamento",
        "desc": "Exclui o orçamento da linha (restrito ao Sup Admin)"
      },
      {
        "key": "orc.export",
        "column": "acao_export",
        "label": "Baixar PDF",
        "desc": "Ícone de download da linha"
      },
      {
        "key": "orc.item.add",
        "column": "acao_item_add",
        "label": "Inserir item",
        "desc": "Botão \"+ Inserir\""
      },
      {
        "key": "orc.item.edit",
        "column": "acao_item_edit",
        "label": "Editar item",
        "desc": "Ícone de lápis na coluna AÇ. da tabela de itens"
      },
      {
        "key": "orc.item.remove",
        "column": "acao_item_remove",
        "label": "Remover item",
        "desc": "Ícone de lixeira na coluna AÇ. da tabela de itens"
      },
      {
        "key": "orc.clear",
        "column": "acao_clear",
        "label": "Limpar tudo",
        "desc": "Botão \"Limpar Tudo\" do modal Novo"
      },
      {
        "key": "orc.send",
        "column": "acao_send",
        "label": "Salvar e enviar",
        "desc": "Botão \"Salvar e Enviar\""
      },
      {
        "key": "orc.status.change",
        "column": "acao_status_change",
        "label": "Alterar status",
        "desc": "Seletor de status (Rascunho / Pendente / Aprovado / Rejeitado / Expirado)"
      },
      {
        "key": "orc.clone",
        "column": "acao_clone",
        "label": "Clonar orçamento",
        "desc": "Botão \"Clonar\" em Editar e em Visualizar"
      },
      {
        "key": "orc.convert.decide",
        "column": "acao_convert_decide",
        "label": "Decidir produção das peças",
        "desc": "Colunas \"Produzir Total\" e \"Produzir Parcial\""
      },
      {
        "key": "orc.convert.justify",
        "column": "acao_convert_justify",
        "label": "Justificar saldo negativo",
        "desc": "Campo de justificativa da conversão"
      },
      {
        "key": "orc.item.replace",
        "column": "acao_item_replace",
        "label": "Substituir peça",
        "desc": "Botão \"Confirmar Substituição\""
      }
    ],
    "columns": [
      {
        "key": "col_orc_num",
        "column": "col_orc_num",
        "label": "Código"
      },
      {
        "key": "col_orc_cliente",
        "column": "col_orc_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_orc_data",
        "column": "col_orc_data",
        "label": "Data"
      },
      {
        "key": "col_orc_total",
        "column": "col_orc_total",
        "label": "Valor Total"
      },
      {
        "key": "col_orc_cond_pagto",
        "column": "col_orc_cond_pagto",
        "label": "Condição"
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
        "key": "col_orc_it_qtd",
        "column": "col_orc_it_qtd",
        "label": "Qtd."
      },
      {
        "key": "col_orc_it_preco",
        "column": "col_orc_it_preco",
        "label": "Un R$"
      },
      {
        "key": "col_orc_it_preco_desc",
        "column": "col_orc_it_preco_desc",
        "label": "Un c/desconto"
      },
      {
        "key": "col_orc_it_desc",
        "column": "col_orc_it_desc",
        "label": "Desconto %"
      },
      {
        "key": "col_orc_it_subtotal",
        "column": "col_orc_it_subtotal",
        "label": "Total R$"
      },
      {
        "key": "col_conv_peca",
        "column": "col_conv_peca",
        "label": "Peça"
      },
      {
        "key": "col_conv_qtd_orcada",
        "column": "col_conv_qtd_orcada",
        "label": "Qtd Orçada"
      },
      {
        "key": "col_conv_em_estoque",
        "column": "col_conv_em_estoque",
        "label": "Em Estoque"
      },
      {
        "key": "col_conv_pronta",
        "column": "col_conv_pronta",
        "label": "Pronta"
      },
      {
        "key": "col_conv_produzir_total",
        "column": "col_conv_produzir_total",
        "label": "Produzir Total"
      },
      {
        "key": "col_conv_produzir_parcial",
        "column": "col_conv_produzir_parcial",
        "label": "Produzir Parcial"
      },
      {
        "key": "col_conv_status",
        "column": "col_conv_status",
        "label": "Status"
      },
      {
        "key": "col_conv_ins_nome",
        "column": "col_conv_ins_nome",
        "label": "Insumo"
      },
      {
        "key": "col_conv_ins_unidade",
        "column": "col_conv_ins_unidade",
        "label": "Unidade"
      },
      {
        "key": "col_conv_ins_disponivel",
        "column": "col_conv_ins_disponivel",
        "label": "Disponível"
      },
      {
        "key": "col_conv_ins_necessario",
        "column": "col_conv_ins_necessario",
        "label": "Necessário"
      },
      {
        "key": "col_conv_ins_saldo",
        "column": "col_conv_ins_saldo",
        "label": "Saldo (prev.)"
      },
      {
        "key": "col_conv_ins_etapa",
        "column": "col_conv_ins_etapa",
        "label": "Etapa"
      },
      {
        "key": "col_conv_ins_flags",
        "column": "col_conv_ins_flags",
        "label": "Flags"
      },
      {
        "key": "col_orc_campo_dono",
        "column": "col_orc_campo_dono",
        "label": "Dono"
      },
      {
        "key": "col_orc_campo_transportadora",
        "column": "col_orc_campo_transportadora",
        "label": "Transportadora"
      },
      {
        "key": "col_orc_campo_pagamento",
        "column": "col_orc_campo_pagamento",
        "label": "Forma de pagamento"
      },
      {
        "key": "col_orc_campo_observacoes",
        "column": "col_orc_campo_observacoes",
        "label": "Observações"
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
        "desc": "Exibir a grade de pedidos"
      },
      {
        "key": "ped.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Filtros de status, período, dono e cliente + Filtrar/Limpar"
      },
      {
        "key": "ped.view.details",
        "column": "acao_view_details",
        "label": "Visualizar pedido",
        "desc": "Ícone de olho — abre \"Visualizar Pedido\""
      },
      {
        "key": "ped.status.confirm",
        "column": "acao_status_confirm",
        "label": "Confirmar pedido",
        "desc": "Ícone \"Concluir\" quando o pedido aguarda confirmação"
      },
      {
        "key": "ped.status.ship",
        "column": "acao_status_ship",
        "label": "Despachar pedido",
        "desc": "Ícone \"Concluir\" quando o pedido está em Produção"
      },
      {
        "key": "ped.status.deliver",
        "column": "acao_status_deliver",
        "label": "Dar como entregue",
        "desc": "Ícone \"Concluir\" quando o pedido está Enviado"
      },
      {
        "key": "ped.report",
        "column": "acao_report",
        "label": "Ver relatório",
        "desc": "Ícone de relatório da linha"
      },
      {
        "key": "ped.delete",
        "column": "acao_delete",
        "label": "Excluir pedido",
        "desc": "Exclui o pedido da linha (restrito ao Sup Admin)"
      },
      {
        "key": "ped.export",
        "column": "acao_export",
        "label": "Baixar PDF",
        "desc": "Ícone de download da linha"
      },
      {
        "key": "ped.cancel",
        "column": "acao_cancel",
        "label": "Cancelar pedido",
        "desc": "Botão \"Cancelar\" no Visualizar e \"Confirmar Cancelamento\""
      },
      {
        "key": "ped.stock.restore_on_cancel",
        "column": "acao_stock_restore_on_cancel",
        "label": "Realocar estoque ao cancelar",
        "desc": "Coluna \"Destinações\" e botão \"Reiniciar Destinação\""
      }
    ],
    "columns": [
      {
        "key": "col_ped_num",
        "column": "col_ped_num",
        "label": "Código"
      },
      {
        "key": "col_ped_cliente",
        "column": "col_ped_cliente",
        "label": "Cliente"
      },
      {
        "key": "col_ped_data",
        "column": "col_ped_data",
        "label": "Data"
      },
      {
        "key": "col_ped_total",
        "column": "col_ped_total",
        "label": "Valor Total"
      },
      {
        "key": "col_ped_condicao",
        "column": "col_ped_condicao",
        "label": "Condição"
      },
      {
        "key": "col_ped_status",
        "column": "col_ped_status",
        "label": "Status"
      },
      {
        "key": "col_ped_it_nome",
        "column": "col_ped_it_nome",
        "label": "Item"
      },
      {
        "key": "col_ped_it_qtd",
        "column": "col_ped_it_qtd",
        "label": "Qtd."
      },
      {
        "key": "col_ped_it_preco",
        "column": "col_ped_it_preco",
        "label": "Un R$"
      },
      {
        "key": "col_ped_it_preco_desc",
        "column": "col_ped_it_preco_desc",
        "label": "Un c/desconto"
      },
      {
        "key": "col_ped_it_desc",
        "column": "col_ped_it_desc",
        "label": "Desconto %"
      },
      {
        "key": "col_ped_it_subtotal",
        "column": "col_ped_it_subtotal",
        "label": "Total R$"
      },
      {
        "key": "col_canc_item",
        "column": "col_canc_item",
        "label": "Item"
      },
      {
        "key": "col_canc_qtd",
        "column": "col_canc_qtd",
        "label": "Quantidade"
      },
      {
        "key": "col_canc_restante",
        "column": "col_canc_restante",
        "label": "Quantidade Restante"
      },
      {
        "key": "col_canc_origem",
        "column": "col_canc_origem",
        "label": "Origem"
      },
      {
        "key": "col_canc_situacao",
        "column": "col_canc_situacao",
        "label": "Situação"
      },
      {
        "key": "col_canc_destinos",
        "column": "col_canc_destinos",
        "label": "Destinações"
      },
      {
        "key": "col_ped_campo_dono",
        "column": "col_ped_campo_dono",
        "label": "Dono"
      },
      {
        "key": "col_ped_campo_transportadora",
        "column": "col_ped_campo_transportadora",
        "label": "Transportadora"
      },
      {
        "key": "col_ped_campo_pagamento",
        "column": "col_ped_campo_pagamento",
        "label": "Forma de pagamento"
      },
      {
        "key": "col_ped_campo_observacoes",
        "column": "col_ped_campo_observacoes",
        "label": "Observações"
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
        "desc": "Exibir a grade de clientes"
      },
      {
        "key": "cli.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Busca, filtros de dono e status + Filtrar/Limpar"
      },
      {
        "key": "cli.create",
        "column": "acao_create",
        "label": "Cadastrar cliente",
        "desc": "Botão \"Novo Cliente\""
      },
      {
        "key": "cli.export.csv",
        "column": "acao_export_csv",
        "label": "Exportar CSV",
        "desc": "Botão \"Exportar CSV\""
      },
      {
        "key": "cli.import.csv",
        "column": "acao_import_csv",
        "label": "Importar CSV",
        "desc": "Botão \"Importar CSV\""
      },
      {
        "key": "cli.report",
        "column": "acao_report",
        "label": "Gerar relatório",
        "desc": "Botão \"Gerar Relatório\""
      },
      {
        "key": "cli.email.bulk",
        "column": "acao_email_bulk",
        "label": "Enviar e-mail em massa",
        "desc": "Botão \"Enviar E-mail em Massa\""
      },
      {
        "key": "cli.details.view",
        "column": "acao_details_view",
        "label": "Ver detalhes",
        "desc": "Ícone de olho — abre \"Detalhes\""
      },
      {
        "key": "cli.edit",
        "column": "acao_edit",
        "label": "Editar cliente",
        "desc": "Ícone de lápis — abre \"Editar\""
      },
      {
        "key": "cli.delete",
        "column": "acao_delete",
        "label": "Excluir cliente",
        "desc": "Ícone de lixeira — abre a confirmação"
      },
      {
        "key": "cli.contact.add",
        "column": "acao_contact_add",
        "label": "Adicionar contato",
        "desc": "Botão \"+ Novo Contato\""
      },
      {
        "key": "cli.contact.edit",
        "column": "acao_contact_edit",
        "label": "Editar contato",
        "desc": "Ícone de lápis na coluna AÇÕES dos contatos"
      },
      {
        "key": "cli.contact.remove",
        "column": "acao_contact_remove",
        "label": "Remover contato",
        "desc": "Ícone de lixeira na coluna AÇÕES dos contatos"
      },
      {
        "key": "cli.order.add",
        "column": "acao_order_add",
        "label": "Adicionar ordem",
        "desc": "Botão \"+ Nova Ordem\""
      },
      {
        "key": "cli.address.copy",
        "column": "acao_address_copy",
        "label": "Copiar endereço",
        "desc": "Botões de copiar entre Registro / Cobrança / Entrega"
      }
    ],
    "columns": [
      {
        "key": "col_cli_nome_fantasia",
        "column": "col_cli_nome_fantasia",
        "label": "Nome"
      },
      {
        "key": "col_cli_cnpj",
        "column": "col_cli_cnpj",
        "label": "CNPJ"
      },
      {
        "key": "col_cli_pais",
        "column": "col_cli_pais",
        "label": "País"
      },
      {
        "key": "col_cli_cidade_uf",
        "column": "col_cli_cidade_uf",
        "label": "Estado"
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
        "key": "col_cli_razao_social",
        "column": "col_cli_razao_social",
        "label": "Razão social"
      },
      {
        "key": "col_cli_insc_estadual",
        "column": "col_cli_insc_estadual",
        "label": "Inscrição estadual"
      },
      {
        "key": "col_cli_site",
        "column": "col_cli_site",
        "label": "Site"
      },
      {
        "key": "col_cli_origem",
        "column": "col_cli_origem",
        "label": "Origem da captação"
      },
      {
        "key": "col_ctt_nome",
        "column": "col_ctt_nome",
        "label": "Nome"
      },
      {
        "key": "col_ctt_cargo",
        "column": "col_ctt_cargo",
        "label": "Cargo"
      },
      {
        "key": "col_ctt_email",
        "column": "col_ctt_email",
        "label": "E-mail"
      },
      {
        "key": "col_ctt_tel",
        "column": "col_ctt_tel",
        "label": "Tel. celular"
      },
      {
        "key": "col_ctt_fixo",
        "column": "col_ctt_fixo",
        "label": "Tel. fixo"
      },
      {
        "key": "col_ord_numero",
        "column": "col_ord_numero",
        "label": "Nº Ordem"
      },
      {
        "key": "col_ord_tipo",
        "column": "col_ord_tipo",
        "label": "Tipo"
      },
      {
        "key": "col_ord_inicio",
        "column": "col_ord_inicio",
        "label": "Início"
      },
      {
        "key": "col_ord_condicao",
        "column": "col_ord_condicao",
        "label": "Cond. Pagamento"
      },
      {
        "key": "col_ord_valor",
        "column": "col_ord_valor",
        "label": "Valor"
      },
      {
        "key": "col_ord_status",
        "column": "col_ord_status",
        "label": "Status"
      },
      {
        "key": "col_end_logradouro",
        "column": "col_end_logradouro",
        "label": "Rua"
      },
      {
        "key": "col_end_numero",
        "column": "col_end_numero",
        "label": "Número"
      },
      {
        "key": "col_end_complemento",
        "column": "col_end_complemento",
        "label": "Complemento"
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
        "key": "col_end_pais",
        "column": "col_end_pais",
        "label": "País"
      },
      {
        "key": "col_end_uf",
        "column": "col_end_uf",
        "label": "Estado"
      },
      {
        "key": "col_end_cep",
        "column": "col_end_cep",
        "label": "CEP"
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
      },
      {
        "key": "pros.contact.add",
        "column": "acao_contact_add",
        "label": "Adicionar contato",
        "desc": "Cadastrar pessoa da empresa prospectada"
      },
      {
        "key": "pros.contact.edit",
        "column": "acao_contact_edit",
        "label": "Editar contato",
        "desc": "Alterar cargo, decisor e dados de contato"
      },
      {
        "key": "pros.contact.remove",
        "column": "acao_contact_remove",
        "label": "Remover contato",
        "desc": "Excluir pessoa da empresa prospectada"
      },
      {
        "key": "pros.interaction.add",
        "column": "acao_interaction_add",
        "label": "Registrar interação",
        "desc": "Lançar ligação, e-mail, reunião ou visita"
      },
      {
        "key": "pros.note.add",
        "column": "acao_note_add",
        "label": "Adicionar nota",
        "desc": "Escrever anotação na prospecção"
      },
      {
        "key": "pros.note.remove",
        "column": "acao_note_remove",
        "label": "Remover nota",
        "desc": "Excluir anotação da prospecção"
      },
      {
        "key": "pros.campaign.manage",
        "column": "acao_campaign_manage",
        "label": "Gerenciar campanhas",
        "desc": "Registrar e acompanhar campanhas"
      },
      {
        "key": "pros.convert",
        "column": "acao_convert",
        "label": "Converter em cliente",
        "desc": "Fechar como Ganho e criar o cliente"
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
        "desc": "Exibir a grade de contatos"
      },
      {
        "key": "ctt.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Botões Filtrar e Limpar"
      },
      {
        "key": "ctt.create",
        "column": "acao_create",
        "label": "Cadastrar contato",
        "desc": "Botão \"Novo Contato\" (aqui e o ícone da linha de Clientes)"
      },
      {
        "key": "ctt.export.csv",
        "column": "acao_export_csv",
        "label": "Exportar CSV",
        "desc": "Botão \"Exportar CSV\""
      },
      {
        "key": "ctt.import.csv",
        "column": "acao_import_csv",
        "label": "Importar CSV",
        "desc": "Botão \"Importar CSV\""
      },
      {
        "key": "ctt.report",
        "column": "acao_report",
        "label": "Gerar relatório",
        "desc": "Botão \"Gerar Relatório\""
      },
      {
        "key": "ctt.email.bulk",
        "column": "acao_email_bulk",
        "label": "Enviar e-mail em massa",
        "desc": "Botão \"Enviar E-mail em Massa\""
      },
      {
        "key": "ctt.edit",
        "column": "acao_edit",
        "label": "Editar contato",
        "desc": "Ícone de lápis da linha"
      }
    ],
    "columns": [
      {
        "key": "col_ctt_nome",
        "column": "col_ctt_nome",
        "label": "Nome"
      },
      {
        "key": "col_ctt_tipo",
        "column": "col_ctt_tipo",
        "label": "Tipo"
      },
      {
        "key": "col_ctt_cliente",
        "column": "col_ctt_cliente",
        "label": "Empresa"
      },
      {
        "key": "col_ctt_tel",
        "column": "col_ctt_tel",
        "label": "Celular"
      },
      {
        "key": "col_ctt_fixo",
        "column": "col_ctt_fixo",
        "label": "Telefone"
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
        "desc": "Exibir o módulo de relatórios"
      },
      {
        "key": "rel.tab.select",
        "column": "acao_tab_select",
        "label": "Escolher relatório",
        "desc": "Abas: Matéria-Prima, Produtos, Clientes, Contatos, Prospecções, Orçamentos, Pedidos, Usuários"
      },
      {
        "key": "rel.search",
        "column": "acao_search",
        "label": "Filtrar registros",
        "desc": "Botões Filtrar e Limpar de cada aba"
      },
      {
        "key": "rel.kpi.view",
        "column": "acao_kpi_view",
        "label": "Ver indicadores",
        "desc": "Painel \"Indicadores\" (KPIs) acima da tabela"
      },
      {
        "key": "rel.view.table",
        "column": "acao_view_table",
        "label": "Ver como tabela",
        "desc": "Botão \"Tabela\""
      },
      {
        "key": "rel.view.charts",
        "column": "acao_view_charts",
        "label": "Ver como gráficos",
        "desc": "Botão \"Gráficos\""
      },
      {
        "key": "rel.view.detail",
        "column": "acao_view_detail",
        "label": "Ver Master-Detail",
        "desc": "Botão \"Master-Detail\""
      },
      {
        "key": "rel.export.csv",
        "column": "acao_export_csv",
        "label": "Exportar CSV",
        "desc": "Opção CSV do botão \"Exportar\""
      },
      {
        "key": "rel.export.xlsx",
        "column": "acao_export_xlsx",
        "label": "Exportar Excel",
        "desc": "Opção Excel do botão \"Exportar\""
      },
      {
        "key": "rel.export.pdf",
        "column": "acao_export_pdf",
        "label": "Exportar PDF",
        "desc": "Opção PDF do botão \"Exportar\""
      },
      {
        "key": "rel.print",
        "column": "acao_print",
        "label": "Imprimir",
        "desc": "Opção Imprimir do botão \"Exportar\""
      },
      {
        "key": "rel.columns.toggle",
        "column": "acao_columns_toggle",
        "label": "Escolher colunas visíveis",
        "desc": "Botão \"Colunas\" — define quais colunas aparecem no resultado"
      },
      {
        "key": "rel.preset.save",
        "column": "acao_preset_save",
        "label": "Salvar modelo",
        "desc": "Botão \"Salvar Modelo\" e o modal de salvamento"
      },
      {
        "key": "rel.preset.load",
        "column": "acao_preset_load",
        "label": "Carregar modelo",
        "desc": "Botão \"Carregar Modelo\""
      },
      {
        "key": "rel.share.send",
        "column": "acao_share_send",
        "label": "Agendar envio",
        "desc": "Botão \"Agendar\" e o modal \"Agendar Relatório\""
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
        "desc": "Abrir o módulo de configurações"
      },
      {
        "key": "cfg.profile.edit",
        "column": "acao_profile_edit",
        "label": "Editar dados pessoais",
        "desc": "Nome, e-mail e telefone + botões Salvar/Cancelar"
      },
      {
        "key": "cfg.password.change",
        "column": "acao_password_change",
        "label": "Alterar senha",
        "desc": "Campos de senha e confirmação"
      },
      {
        "key": "cfg.avatar.edit",
        "column": "acao_avatar_edit",
        "label": "Alterar foto de perfil",
        "desc": "Carregar imagem e botão \"Remover foto\""
      },
      {
        "key": "cfg.prefs.edit",
        "column": "acao_prefs_edit",
        "label": "Editar preferências do menu",
        "desc": "Módulo inicial, CRM expandido e comportamento da barra lateral"
      },
      {
        "key": "cfg.theme.edit",
        "column": "acao_theme_edit",
        "label": "Editar tema",
        "desc": "Chave de alternância do tema"
      },
      {
        "key": "cfg.notifications.edit",
        "column": "acao_notifications_edit",
        "label": "Editar notificações",
        "desc": "Chave de notificações no menu"
      },
      {
        "key": "cfg.quickactions.edit",
        "column": "acao_quickactions_edit",
        "label": "Editar ações rápidas",
        "desc": "Chaves de sair, minimizar, recarregar, tela, fechar, avatar e nome"
      },
      {
        "key": "cfg.categories.edit",
        "column": "acao_categories_edit",
        "label": "Editar categorias relevantes",
        "desc": "Chaves de sistema, tarefas, vendas e financeiro"
      },
      {
        "key": "cfg.roles.view",
        "column": "acao_roles_view",
        "label": "Ver perfis de permissão",
        "desc": "Filtros da tela de Gestão de Usuários"
      },
      {
        "key": "cfg.roles.edit",
        "column": "acao_roles_edit",
        "label": "Editar perfis de permissão",
        "desc": "Botão \"Modelos de Permissão\" e o modal dele"
      }
    ],
    "columns": []
  },
  "usuarios": {
    "code": "usuarios",
    "label": "Usuários",
    "page": "usuarios",
    "table": "perm_usuarios",
    "configured": true,
    "actions": [
      {
        "key": "usuarios.view",
        "column": "acao_view",
        "label": "Ver lista",
        "desc": "Visualizar a grade de usuários"
      },
      {
        "key": "usuarios.search",
        "column": "acao_search",
        "label": "Buscar/filtrar",
        "desc": "Habilitar busca e filtros de perfil/status"
      },
      {
        "key": "usuarios.create",
        "column": "acao_create",
        "label": "Cadastrar usuário",
        "desc": "Criar novos usuários no sistema"
      },
      {
        "key": "usuarios.edit",
        "column": "acao_edit",
        "label": "Editar usuário",
        "desc": "Alterar dados pessoais, perfil e status"
      },
      {
        "key": "usuarios.delete",
        "column": "acao_delete",
        "label": "Excluir usuário",
        "desc": "Remover usuários do sistema"
      },
      {
        "key": "usuarios.status.toggle",
        "column": "acao_status_toggle",
        "label": "Ativar/desativar acesso",
        "desc": "Ligar ou desligar o acesso de um usuário"
      },
      {
        "key": "usuarios.activity.view",
        "column": "acao_activity_view",
        "label": "Ver atividade",
        "desc": "Consultar último login e alterações registradas"
      },
      {
        "key": "usuarios.approve",
        "column": "acao_approve",
        "label": "Aprovar cadastro",
        "desc": "Liberar o acesso de usuários aguardando aprovação"
      },
      {
        "key": "usuarios.roles.view",
        "column": "acao_roles_view",
        "label": "Ver modelos de permissão",
        "desc": "Abrir os modelos (perfis) de permissão"
      },
      {
        "key": "usuarios.roles.manage",
        "column": "acao_roles_manage",
        "label": "Gerenciar modelos de permissão",
        "desc": "Criar, editar, duplicar e excluir perfis"
      },
      {
        "key": "usuarios.roles.assign",
        "column": "acao_roles_assign",
        "label": "Aplicar perfil ao usuário",
        "desc": "Vincular um modelo de permissão a um usuário"
      }
    ],
    "columns": [
      {
        "key": "col_usr_avatar",
        "column": "col_usr_avatar",
        "label": "Avatar"
      },
      {
        "key": "col_usr_nome",
        "column": "col_usr_nome",
        "label": "Nome"
      },
      {
        "key": "col_usr_email",
        "column": "col_usr_email",
        "label": "E-mail"
      },
      {
        "key": "col_usr_perfil",
        "column": "col_usr_perfil",
        "label": "Perfil"
      },
      {
        "key": "col_usr_situacao",
        "column": "col_usr_situacao",
        "label": "Situação (online/offline)"
      },
      {
        "key": "col_usr_status",
        "column": "col_usr_status",
        "label": "Status"
      },
      {
        "key": "col_usr_ultimo_login",
        "column": "col_usr_ultimo_login",
        "label": "Último login"
      },
      {
        "key": "col_usr_ultima_alteracao",
        "column": "col_usr_ultima_alteracao",
        "label": "Última alteração"
      },
      {
        "key": "col_usr_acoes",
        "column": "col_usr_acoes",
        "label": "Ações"
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
