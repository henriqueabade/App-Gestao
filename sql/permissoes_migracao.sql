-- =====================================================================
-- MIGRAÇÃO INCREMENTAL DE PERMISSÕES — App-Gestao
-- Seguro rodar em banco JÁ EXISTENTE: só adiciona o que falta.
-- Regenerado por: node scripts/gerar-permissoes.js
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS modelos_permissoes (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(120) NOT NULL UNIQUE,
  descricao     TEXT,
  criado_em     TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS modelo_permissoes_id INTEGER
  REFERENCES modelos_permissoes(id) ON DELETE SET NULL;

-- Matéria-prima (perm_mp)
CREATE TABLE IF NOT EXISTS perm_mp (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.view · Ver lista
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.search · Buscar/filtrar
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.create · Cadastrar insumo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_totals_view BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.totals.view · Ver totais por tipo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.edit · Editar insumo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.delete · Excluir insumo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_stock_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.stock.edit · Editar quantidade em estoque
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_stock_infinite_toggle BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.stock.infinite_toggle · Alternar estoque infinito
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_category_view BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.category.view · Selecionar categoria
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_category_create BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.category.create · Cadastrar categoria
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_category_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.category.delete · Excluir categoria
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_unit_view BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.unit.view · Selecionar unidade
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_unit_create BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.unit.create · Cadastrar unidade
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_unit_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.unit.delete · Excluir unidade
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_process_view BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.process.view · Selecionar processo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_process_create BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.process.create · Cadastrar processo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_process_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.process.delete · Excluir processo
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS acao_process_order BOOLEAN NOT NULL DEFAULT FALSE;  -- mp.process.order · Resolver ordem duplicada
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS col_mp_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS col_mp_estoque_atual BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS col_mp_unidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Unidade
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS col_mp_custo_medio BOOLEAN NOT NULL DEFAULT FALSE;  -- Preço Unitário
ALTER TABLE perm_mp ADD COLUMN IF NOT EXISTS col_mp_campo_descricao BOOLEAN NOT NULL DEFAULT FALSE;  -- Descrição

-- Produtos (perm_prod)
CREATE TABLE IF NOT EXISTS perm_prod (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.view · Ver lista
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.search · Buscar/filtrar
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.create · Cadastrar produto
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stock_view BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stock.view · Ver estoque
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_details_view BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.details.view · Visualizar produto
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.edit · Editar produto
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.delete · Excluir produto
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_item_add BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.item.add · Adicionar item
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_item_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.item.edit · Editar item
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_item_remove BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.item.remove · Remover item
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_clear BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.clear · Limpar tudo
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_percent_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.percent.edit · Editar percentagens
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_collection_create BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.collection.create · Cadastrar coleção
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_collection_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.collection.delete · Excluir coleção
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_clone BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.clone · Clonar produto
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_registro_toggle BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.registro.toggle · Alternar registro
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_pdf BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.pdf · Gerar PDF
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stage_insert BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stage.insert · Registrar processo
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stage_item_add BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stage.item.add · Inserir item no processo
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stage_item_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stage.item.edit · Editar item do processo
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stage_item_remove BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stage.item.remove · Excluir item do processo
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stage_clear BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stage.clear · Limpar itens do processo
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stock_input BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stock.input · Adicionar ao estoque
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stock_adjust BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stock.adjust · Somar ao existente
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS acao_stock_lote_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- prod.stock.lote.delete · Excluir lote de estoque
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_sku BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_colecao BOOLEAN NOT NULL DEFAULT FALSE;  -- Coleção
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_preco_base BOOLEAN NOT NULL DEFAULT FALSE;  -- Preço de Venda
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_margem BOOLEAN NOT NULL DEFAULT FALSE;  -- Margem (%)
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_prod_estoque BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_ins_mp BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome do item
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_ins_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_ins_unidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Unidade
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_ins_custo_un BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor unitário
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_ins_custo_total BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor total
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_etapa_item BOOLEAN NOT NULL DEFAULT FALSE;  -- Item
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_etapa_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_etapa_unidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Unidade
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_etapa_valor_un BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor unitário (R$)
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_etapa_valor_total BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor total (R$)
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_est_processo BOOLEAN NOT NULL DEFAULT FALSE;  -- Processo atual
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_est_ultimo_item BOOLEAN NOT NULL DEFAULT FALSE;  -- Último item
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_est_quantidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade em estoque
ALTER TABLE perm_prod ADD COLUMN IF NOT EXISTS col_est_alterado_em BOOLEAN NOT NULL DEFAULT FALSE;  -- Última alteração

-- Orçamentos (perm_orc)
CREATE TABLE IF NOT EXISTS perm_orc (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.view · Ver lista
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.search · Buscar/filtrar
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.create · Criar orçamento
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_view_details BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.view.details · Visualizar orçamento
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.edit · Editar orçamento
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_convert BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.convert · Converter em pedido
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_export BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.export · Baixar PDF
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_item_add BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.item.add · Inserir item
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_item_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.item.edit · Editar item
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_item_remove BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.item.remove · Remover item
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_clear BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.clear · Limpar tudo
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_send BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.send · Salvar e enviar
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_status_change BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.status.change · Alterar status
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_clone BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.clone · Clonar orçamento
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_convert_decide BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.convert.decide · Decidir produção das peças
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_convert_justify BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.convert.justify · Justificar saldo negativo
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS acao_item_replace BOOLEAN NOT NULL DEFAULT FALSE;  -- orc.item.replace · Substituir peça
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_num BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_cliente BOOLEAN NOT NULL DEFAULT FALSE;  -- Cliente
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Data
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_total BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor Total
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_cond_pagto BOOLEAN NOT NULL DEFAULT FALSE;  -- Condição
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_it_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Item
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_it_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Qtd.
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_it_preco BOOLEAN NOT NULL DEFAULT FALSE;  -- Un R$
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_it_preco_desc BOOLEAN NOT NULL DEFAULT FALSE;  -- Un c/desconto
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_it_desc BOOLEAN NOT NULL DEFAULT FALSE;  -- Desconto %
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_it_subtotal BOOLEAN NOT NULL DEFAULT FALSE;  -- Total R$
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_peca BOOLEAN NOT NULL DEFAULT FALSE;  -- Peça
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_qtd_orcada BOOLEAN NOT NULL DEFAULT FALSE;  -- Qtd Orçada
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_em_estoque BOOLEAN NOT NULL DEFAULT FALSE;  -- Em Estoque
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_pronta BOOLEAN NOT NULL DEFAULT FALSE;  -- Pronta
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_produzir_total BOOLEAN NOT NULL DEFAULT FALSE;  -- Produzir Total
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_produzir_parcial BOOLEAN NOT NULL DEFAULT FALSE;  -- Produzir Parcial
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Insumo
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_unidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Unidade
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_disponivel BOOLEAN NOT NULL DEFAULT FALSE;  -- Disponível
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_necessario BOOLEAN NOT NULL DEFAULT FALSE;  -- Necessário
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_saldo BOOLEAN NOT NULL DEFAULT FALSE;  -- Saldo (prev.)
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_etapa BOOLEAN NOT NULL DEFAULT FALSE;  -- Etapa
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_conv_ins_flags BOOLEAN NOT NULL DEFAULT FALSE;  -- Flags
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_campo_dono BOOLEAN NOT NULL DEFAULT FALSE;  -- Dono
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_campo_transportadora BOOLEAN NOT NULL DEFAULT FALSE;  -- Transportadora
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_campo_pagamento BOOLEAN NOT NULL DEFAULT FALSE;  -- Forma de pagamento
ALTER TABLE perm_orc ADD COLUMN IF NOT EXISTS col_orc_campo_observacoes BOOLEAN NOT NULL DEFAULT FALSE;  -- Observações

-- Pedidos (perm_ped)
CREATE TABLE IF NOT EXISTS perm_ped (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.view · Ver lista
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.search · Buscar/filtrar
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_view_details BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.view.details · Visualizar pedido
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_status_confirm BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.status.confirm · Confirmar pedido
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_status_ship BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.status.ship · Despachar pedido
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_status_deliver BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.status.deliver · Dar como entregue
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_report BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.report · Ver relatório
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_export BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.export · Baixar PDF
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_cancel BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.cancel · Cancelar pedido
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS acao_stock_restore_on_cancel BOOLEAN NOT NULL DEFAULT FALSE;  -- ped.stock.restore_on_cancel · Realocar estoque ao cancelar
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_num BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_cliente BOOLEAN NOT NULL DEFAULT FALSE;  -- Cliente
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Data
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_total BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor Total
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_condicao BOOLEAN NOT NULL DEFAULT FALSE;  -- Condição
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_it_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Item
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_it_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Qtd.
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_it_preco BOOLEAN NOT NULL DEFAULT FALSE;  -- Un R$
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_it_preco_desc BOOLEAN NOT NULL DEFAULT FALSE;  -- Un c/desconto
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_it_desc BOOLEAN NOT NULL DEFAULT FALSE;  -- Desconto %
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_it_subtotal BOOLEAN NOT NULL DEFAULT FALSE;  -- Total R$
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_canc_item BOOLEAN NOT NULL DEFAULT FALSE;  -- Item
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_canc_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_canc_restante BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade Restante
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_canc_origem BOOLEAN NOT NULL DEFAULT FALSE;  -- Origem
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_canc_situacao BOOLEAN NOT NULL DEFAULT FALSE;  -- Situação
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_canc_destinos BOOLEAN NOT NULL DEFAULT FALSE;  -- Destinações
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_campo_dono BOOLEAN NOT NULL DEFAULT FALSE;  -- Dono
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_campo_transportadora BOOLEAN NOT NULL DEFAULT FALSE;  -- Transportadora
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_campo_pagamento BOOLEAN NOT NULL DEFAULT FALSE;  -- Forma de pagamento
ALTER TABLE perm_ped ADD COLUMN IF NOT EXISTS col_ped_campo_observacoes BOOLEAN NOT NULL DEFAULT FALSE;  -- Observações

-- Clientes (perm_cli)
CREATE TABLE IF NOT EXISTS perm_cli (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- cli.view · Ver lista
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- cli.search · Buscar/filtrar
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS acao_details_view BOOLEAN NOT NULL DEFAULT FALSE;  -- cli.details.view · Ver detalhes
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- cli.create · Cadastrar cliente
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- cli.edit · Editar cliente
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS acao_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- cli.delete · Excluir cliente
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_nome_fantasia BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome fantasia
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_razao_social BOOLEAN NOT NULL DEFAULT FALSE;  -- Razão social
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_cnpj BOOLEAN NOT NULL DEFAULT FALSE;  -- CNPJ
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_comprador BOOLEAN NOT NULL DEFAULT FALSE;  -- Comprador/contato
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_tel BOOLEAN NOT NULL DEFAULT FALSE;  -- Telefone
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_email BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_cidade_uf BOOLEAN NOT NULL DEFAULT FALSE;  -- Cidade/UF
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_transportadora BOOLEAN NOT NULL DEFAULT FALSE;  -- Transportadora
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_cli_owner BOOLEAN NOT NULL DEFAULT FALSE;  -- Dono
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_tipo BOOLEAN NOT NULL DEFAULT FALSE;  -- Tipo
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_logradouro BOOLEAN NOT NULL DEFAULT FALSE;  -- Logradouro
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_numero BOOLEAN NOT NULL DEFAULT FALSE;  -- Nº
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_complemento BOOLEAN NOT NULL DEFAULT FALSE;  -- Compl.
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_bairro BOOLEAN NOT NULL DEFAULT FALSE;  -- Bairro
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_cidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Cidade
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_uf BOOLEAN NOT NULL DEFAULT FALSE;  -- UF
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_end_cep BOOLEAN NOT NULL DEFAULT FALSE;  -- CEP
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Contato
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_cargo BOOLEAN NOT NULL DEFAULT FALSE;  -- Cargo
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_tel BOOLEAN NOT NULL DEFAULT FALSE;  -- Telefone
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_email BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_tags BOOLEAN NOT NULL DEFAULT FALSE;  -- Tags
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_cli ADD COLUMN IF NOT EXISTS col_ctt_ult_interacao BOOLEAN NOT NULL DEFAULT FALSE;  -- Últ. interação

-- Prospecções (perm_pros)
CREATE TABLE IF NOT EXISTS perm_pros (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.view · Ver lista
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.search · Buscar/filtrar
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_details_view BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.details.view · Ver detalhes
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.create · Cadastrar prospecção
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.edit · Editar prospecção
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.delete · Excluir prospecção
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_stage_update BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.stage.update · Atualizar etapa
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS acao_next_step BOOLEAN NOT NULL DEFAULT FALSE;  -- pros.next.step · Definir próximo passo
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_id BOOLEAN NOT NULL DEFAULT FALSE;  -- ID
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_entidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Entidade
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_origem BOOLEAN NOT NULL DEFAULT FALSE;  -- Origem
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_etapa BOOLEAN NOT NULL DEFAULT FALSE;  -- Etapa
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_valor BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_prob BOOLEAN NOT NULL DEFAULT FALSE;  -- Prob. (%)
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_owner BOOLEAN NOT NULL DEFAULT FALSE;  -- Dono
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_proximo_passo BOOLEAN NOT NULL DEFAULT FALSE;  -- Próx. passo
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_proximo_passo_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Para quando
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_pros_atualizado_em BOOLEAN NOT NULL DEFAULT FALSE;  -- Atualizado em
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_hist_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Data
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_hist_tipo BOOLEAN NOT NULL DEFAULT FALSE;  -- Tipo
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_hist_resumo BOOLEAN NOT NULL DEFAULT FALSE;  -- Resumo
ALTER TABLE perm_pros ADD COLUMN IF NOT EXISTS col_hist_resp BOOLEAN NOT NULL DEFAULT FALSE;  -- Responsável

-- Contatos (perm_ctt)
CREATE TABLE IF NOT EXISTS perm_ctt (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.view · Ver lista
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.search · Buscar/filtrar
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_details_view BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.details.view · Ver detalhes
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.create · Cadastrar contato
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.edit · Editar contato
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_link_client BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.link.client · Vincular a cliente
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_unlink_client BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.unlink.client · Desvincular de cliente
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_log_add BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.log.add · Registrar interação
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_log_view BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.log.view · Ver interações
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_status_update BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.status.update · Atualizar status
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_tag_manage BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.tag.manage · Gerenciar tags
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS acao_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- ctt.delete · Excluir contato
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Contato
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_cliente BOOLEAN NOT NULL DEFAULT FALSE;  -- Cliente
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_cargo BOOLEAN NOT NULL DEFAULT FALSE;  -- Cargo
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_tel BOOLEAN NOT NULL DEFAULT FALSE;  -- Telefone
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_email BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_origem BOOLEAN NOT NULL DEFAULT FALSE;  -- Origem
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_tags BOOLEAN NOT NULL DEFAULT FALSE;  -- Tags
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_ult_interacao BOOLEAN NOT NULL DEFAULT FALSE;  -- Últ. interação
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_ctt_owner BOOLEAN NOT NULL DEFAULT FALSE;  -- Dono
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_log_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Data
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_log_canal BOOLEAN NOT NULL DEFAULT FALSE;  -- Canal
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_log_assunto BOOLEAN NOT NULL DEFAULT FALSE;  -- Assunto
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_log_detalhes BOOLEAN NOT NULL DEFAULT FALSE;  -- Detalhes
ALTER TABLE perm_ctt ADD COLUMN IF NOT EXISTS col_log_resp BOOLEAN NOT NULL DEFAULT FALSE;  -- Responsável

-- Relatórios (perm_rel)
CREATE TABLE IF NOT EXISTS perm_rel (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.view · Ver módulo
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_search BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.search · Buscar/filtrar
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_run BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.run · Rodar relatório
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_export_csv BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.export.csv · Exportar CSV
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_export_xlsx BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.export.xlsx · Exportar XLSX
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_export_pdf BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.export.pdf · Exportar PDF
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_preset_save BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.preset.save · Salvar preset
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_preset_load BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.preset.load · Carregar preset
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_preset_manage BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.preset.manage · Gerenciar presets
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_share_link BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.share.link · Gerar link compartilhável
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS acao_share_send BOOLEAN NOT NULL DEFAULT FALSE;  -- rel.share.send · Enviar relatório
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_categoria BOOLEAN NOT NULL DEFAULT FALSE;  -- Categoria
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_unidade BOOLEAN NOT NULL DEFAULT FALSE;  -- Unidade
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_preco BOOLEAN NOT NULL DEFAULT FALSE;  -- Preço
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_processo BOOLEAN NOT NULL DEFAULT FALSE;  -- Processo
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_estq_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_codigo BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_colecao BOOLEAN NOT NULL DEFAULT FALSE;  -- Coleção
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_preco_venda BOOLEAN NOT NULL DEFAULT FALSE;  -- Preço de Venda
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_margem BOOLEAN NOT NULL DEFAULT FALSE;  -- Margem (%)
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_qtd BOOLEAN NOT NULL DEFAULT FALSE;  -- Quantidade
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_prod_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_cli_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_cli_cnpj BOOLEAN NOT NULL DEFAULT FALSE;  -- CNPJ
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_cli_pais BOOLEAN NOT NULL DEFAULT FALSE;  -- País
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_cli_estado BOOLEAN NOT NULL DEFAULT FALSE;  -- Estado
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_cli_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_cli_dono BOOLEAN NOT NULL DEFAULT FALSE;  -- Dono
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ctt_contato BOOLEAN NOT NULL DEFAULT FALSE;  -- Contato
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ctt_tipo BOOLEAN NOT NULL DEFAULT FALSE;  -- Tipo
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ctt_empresa BOOLEAN NOT NULL DEFAULT FALSE;  -- Empresa
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ctt_celular BOOLEAN NOT NULL DEFAULT FALSE;  -- Celular
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ctt_telefone BOOLEAN NOT NULL DEFAULT FALSE;  -- Telefone
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ctt_email BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_pros_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome do Lead
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_pros_email BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_pros_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_pros_responsavel BOOLEAN NOT NULL DEFAULT FALSE;  -- Responsável
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_orc_codigo BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_orc_cliente BOOLEAN NOT NULL DEFAULT FALSE;  -- Cliente
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_orc_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Data
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_orc_valor BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor Total
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_orc_condicao BOOLEAN NOT NULL DEFAULT FALSE;  -- Condição
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_orc_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ped_codigo BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ped_cliente BOOLEAN NOT NULL DEFAULT FALSE;  -- Cliente
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ped_data BOOLEAN NOT NULL DEFAULT FALSE;  -- Data
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ped_valor BOOLEAN NOT NULL DEFAULT FALSE;  -- Valor Total
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ped_condicao BOOLEAN NOT NULL DEFAULT FALSE;  -- Condição
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_ped_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_usr_avatar BOOLEAN NOT NULL DEFAULT FALSE;  -- Avatar
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_usr_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_usr_email BOOLEAN NOT NULL DEFAULT FALSE;  -- E-mail
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_usr_perfil BOOLEAN NOT NULL DEFAULT FALSE;  -- Perfil
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_usr_situacao BOOLEAN NOT NULL DEFAULT FALSE;  -- Situação
ALTER TABLE perm_rel ADD COLUMN IF NOT EXISTS col_rel_usr_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status

-- Tarefas (perm_tarefas)
CREATE TABLE IF NOT EXISTS perm_tarefas (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- tarefas.view · Ver tarefas/agenda
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS acao_create BOOLEAN NOT NULL DEFAULT FALSE;  -- tarefas.create · Criar tarefa
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS acao_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- tarefas.edit · Editar tarefa
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS acao_delete BOOLEAN NOT NULL DEFAULT FALSE;  -- tarefas.delete · Excluir tarefa
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS acao_assign BOOLEAN NOT NULL DEFAULT FALSE;  -- tarefas.assign · Atribuir tarefa
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS acao_calendar_view BOOLEAN NOT NULL DEFAULT FALSE;  -- tarefas.calendar.view · Ver calendário
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_tsk_titulo BOOLEAN NOT NULL DEFAULT FALSE;  -- Título
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_tsk_resp BOOLEAN NOT NULL DEFAULT FALSE;  -- Responsável
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_tsk_prazo BOOLEAN NOT NULL DEFAULT FALSE;  -- Prazo
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_tsk_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_tsk_prioridade BOOLEAN NOT NULL DEFAULT FALSE;  -- Prioridade
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_evt_titulo BOOLEAN NOT NULL DEFAULT FALSE;  -- Evento
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_evt_inicio BOOLEAN NOT NULL DEFAULT FALSE;  -- Início
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_evt_fim BOOLEAN NOT NULL DEFAULT FALSE;  -- Fim
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_evt_local BOOLEAN NOT NULL DEFAULT FALSE;  -- Local
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_evt_participantes BOOLEAN NOT NULL DEFAULT FALSE;  -- Participantes
ALTER TABLE perm_tarefas ADD COLUMN IF NOT EXISTS col_evt_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status

-- Configurações (perm_cfg)
CREATE TABLE IF NOT EXISTS perm_cfg (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS acao_view BOOLEAN NOT NULL DEFAULT FALSE;  -- cfg.view · Ver configurações
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS acao_theme_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- cfg.theme.edit · Editar tema
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS acao_integrations_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- cfg.integrations.edit · Editar integrações
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS acao_prefs_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- cfg.prefs.edit · Editar preferências gerais
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS acao_roles_view BOOLEAN NOT NULL DEFAULT FALSE;  -- cfg.roles.view · Ver papéis/perfis
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS acao_roles_edit BOOLEAN NOT NULL DEFAULT FALSE;  -- cfg.roles.edit · Editar papéis/perfis
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_role_code BOOLEAN NOT NULL DEFAULT FALSE;  -- Código
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_role_name BOOLEAN NOT NULL DEFAULT FALSE;  -- Nome
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_role_desc BOOLEAN NOT NULL DEFAULT FALSE;  -- Descrição
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_role_modulos BOOLEAN NOT NULL DEFAULT FALSE;  -- Módulos
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_role_features BOOLEAN NOT NULL DEFAULT FALSE;  -- Ações
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_int_nome BOOLEAN NOT NULL DEFAULT FALSE;  -- Integração
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_int_status BOOLEAN NOT NULL DEFAULT FALSE;  -- Status
ALTER TABLE perm_cfg ADD COLUMN IF NOT EXISTS col_int_ult_sync BOOLEAN NOT NULL DEFAULT FALSE;  -- Últ. sync

-- Dashboard (perm_dashboard)
CREATE TABLE IF NOT EXISTS perm_dashboard (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Calendário (perm_calendario)
CREATE TABLE IF NOT EXISTS perm_calendario (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Laminação · Clientes (perm_lam_clientes)
CREATE TABLE IF NOT EXISTS perm_lam_clientes (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Laminação · Serviços (perm_lam_servicos)
CREATE TABLE IF NOT EXISTS perm_lam_servicos (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Laminação · Precificação (perm_lam_precificacao)
CREATE TABLE IF NOT EXISTS perm_lam_precificacao (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Laminação · Relatórios (perm_lam_relatorios)
CREATE TABLE IF NOT EXISTS perm_lam_relatorios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- IA (perm_ia)
CREATE TABLE IF NOT EXISTS perm_ia (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Usuários (perm_usuarios)
CREATE TABLE IF NOT EXISTS perm_usuarios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Financeiro (perm_financeiro)
CREATE TABLE IF NOT EXISTS perm_financeiro (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- Garante 1 linha por perfil em cada tabela (perfis já existentes)
INSERT INTO perm_mp (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_prod (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_orc (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_ped (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_cli (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_pros (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_ctt (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_rel (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_tarefas (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_cfg (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_dashboard (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_calendario (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_lam_clientes (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_lam_servicos (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_lam_precificacao (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_lam_relatorios (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_ia (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_usuarios (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;
INSERT INTO perm_financeiro (modelo_id) SELECT id FROM modelos_permissoes ON CONFLICT (modelo_id) DO NOTHING;

-- Mantém o perfil "Administrador" com tudo liberado
UPDATE perm_mp SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_create = TRUE, acao_totals_view = TRUE, acao_edit = TRUE, acao_delete = TRUE, acao_stock_edit = TRUE, acao_stock_infinite_toggle = TRUE, acao_category_view = TRUE, acao_category_create = TRUE, acao_category_delete = TRUE, acao_unit_view = TRUE, acao_unit_create = TRUE, acao_unit_delete = TRUE, acao_process_view = TRUE, acao_process_create = TRUE, acao_process_delete = TRUE, acao_process_order = TRUE, col_mp_nome = TRUE, col_mp_estoque_atual = TRUE, col_mp_unidade = TRUE, col_mp_custo_medio = TRUE, col_mp_campo_descricao = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_prod SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_create = TRUE, acao_stock_view = TRUE, acao_details_view = TRUE, acao_edit = TRUE, acao_delete = TRUE, acao_item_add = TRUE, acao_item_edit = TRUE, acao_item_remove = TRUE, acao_clear = TRUE, acao_percent_edit = TRUE, acao_collection_create = TRUE, acao_collection_delete = TRUE, acao_clone = TRUE, acao_registro_toggle = TRUE, acao_pdf = TRUE, acao_stage_insert = TRUE, acao_stage_item_add = TRUE, acao_stage_item_edit = TRUE, acao_stage_item_remove = TRUE, acao_stage_clear = TRUE, acao_stock_input = TRUE, acao_stock_adjust = TRUE, acao_stock_lote_delete = TRUE, col_prod_sku = TRUE, col_prod_nome = TRUE, col_prod_colecao = TRUE, col_prod_preco_base = TRUE, col_prod_margem = TRUE, col_prod_estoque = TRUE, col_ins_mp = TRUE, col_ins_qtd = TRUE, col_ins_unidade = TRUE, col_ins_custo_un = TRUE, col_ins_custo_total = TRUE, col_etapa_item = TRUE, col_etapa_qtd = TRUE, col_etapa_unidade = TRUE, col_etapa_valor_un = TRUE, col_etapa_valor_total = TRUE, col_est_processo = TRUE, col_est_ultimo_item = TRUE, col_est_quantidade = TRUE, col_est_alterado_em = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_orc SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_create = TRUE, acao_view_details = TRUE, acao_edit = TRUE, acao_convert = TRUE, acao_export = TRUE, acao_item_add = TRUE, acao_item_edit = TRUE, acao_item_remove = TRUE, acao_clear = TRUE, acao_send = TRUE, acao_status_change = TRUE, acao_clone = TRUE, acao_convert_decide = TRUE, acao_convert_justify = TRUE, acao_item_replace = TRUE, col_orc_num = TRUE, col_orc_cliente = TRUE, col_orc_data = TRUE, col_orc_total = TRUE, col_orc_cond_pagto = TRUE, col_orc_status = TRUE, col_orc_it_nome = TRUE, col_orc_it_qtd = TRUE, col_orc_it_preco = TRUE, col_orc_it_preco_desc = TRUE, col_orc_it_desc = TRUE, col_orc_it_subtotal = TRUE, col_conv_peca = TRUE, col_conv_qtd_orcada = TRUE, col_conv_em_estoque = TRUE, col_conv_pronta = TRUE, col_conv_produzir_total = TRUE, col_conv_produzir_parcial = TRUE, col_conv_status = TRUE, col_conv_ins_nome = TRUE, col_conv_ins_unidade = TRUE, col_conv_ins_disponivel = TRUE, col_conv_ins_necessario = TRUE, col_conv_ins_saldo = TRUE, col_conv_ins_etapa = TRUE, col_conv_ins_flags = TRUE, col_orc_campo_dono = TRUE, col_orc_campo_transportadora = TRUE, col_orc_campo_pagamento = TRUE, col_orc_campo_observacoes = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_ped SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_view_details = TRUE, acao_status_confirm = TRUE, acao_status_ship = TRUE, acao_status_deliver = TRUE, acao_report = TRUE, acao_export = TRUE, acao_cancel = TRUE, acao_stock_restore_on_cancel = TRUE, col_ped_num = TRUE, col_ped_cliente = TRUE, col_ped_data = TRUE, col_ped_total = TRUE, col_ped_condicao = TRUE, col_ped_status = TRUE, col_ped_it_nome = TRUE, col_ped_it_qtd = TRUE, col_ped_it_preco = TRUE, col_ped_it_preco_desc = TRUE, col_ped_it_desc = TRUE, col_ped_it_subtotal = TRUE, col_canc_item = TRUE, col_canc_qtd = TRUE, col_canc_restante = TRUE, col_canc_origem = TRUE, col_canc_situacao = TRUE, col_canc_destinos = TRUE, col_ped_campo_dono = TRUE, col_ped_campo_transportadora = TRUE, col_ped_campo_pagamento = TRUE, col_ped_campo_observacoes = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_cli SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_details_view = TRUE, acao_create = TRUE, acao_edit = TRUE, acao_delete = TRUE, col_cli_nome_fantasia = TRUE, col_cli_razao_social = TRUE, col_cli_cnpj = TRUE, col_cli_comprador = TRUE, col_cli_tel = TRUE, col_cli_email = TRUE, col_cli_cidade_uf = TRUE, col_cli_transportadora = TRUE, col_cli_status = TRUE, col_cli_owner = TRUE, col_end_tipo = TRUE, col_end_logradouro = TRUE, col_end_numero = TRUE, col_end_complemento = TRUE, col_end_bairro = TRUE, col_end_cidade = TRUE, col_end_uf = TRUE, col_end_cep = TRUE, col_ctt_nome = TRUE, col_ctt_cargo = TRUE, col_ctt_tel = TRUE, col_ctt_email = TRUE, col_ctt_tags = TRUE, col_ctt_status = TRUE, col_ctt_ult_interacao = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_pros SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_details_view = TRUE, acao_create = TRUE, acao_edit = TRUE, acao_delete = TRUE, acao_stage_update = TRUE, acao_next_step = TRUE, col_pros_id = TRUE, col_pros_entidade = TRUE, col_pros_origem = TRUE, col_pros_etapa = TRUE, col_pros_valor = TRUE, col_pros_prob = TRUE, col_pros_owner = TRUE, col_pros_proximo_passo = TRUE, col_pros_proximo_passo_data = TRUE, col_pros_atualizado_em = TRUE, col_hist_data = TRUE, col_hist_tipo = TRUE, col_hist_resumo = TRUE, col_hist_resp = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_ctt SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_details_view = TRUE, acao_create = TRUE, acao_edit = TRUE, acao_link_client = TRUE, acao_unlink_client = TRUE, acao_log_add = TRUE, acao_log_view = TRUE, acao_status_update = TRUE, acao_tag_manage = TRUE, acao_delete = TRUE, col_ctt_nome = TRUE, col_ctt_cliente = TRUE, col_ctt_cargo = TRUE, col_ctt_tel = TRUE, col_ctt_email = TRUE, col_ctt_origem = TRUE, col_ctt_tags = TRUE, col_ctt_status = TRUE, col_ctt_ult_interacao = TRUE, col_ctt_owner = TRUE, col_log_data = TRUE, col_log_canal = TRUE, col_log_assunto = TRUE, col_log_detalhes = TRUE, col_log_resp = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_rel SET modulo_ativo = TRUE, acao_view = TRUE, acao_search = TRUE, acao_run = TRUE, acao_export_csv = TRUE, acao_export_xlsx = TRUE, acao_export_pdf = TRUE, acao_preset_save = TRUE, acao_preset_load = TRUE, acao_preset_manage = TRUE, acao_share_link = TRUE, acao_share_send = TRUE, col_rel_estq_nome = TRUE, col_rel_estq_categoria = TRUE, col_rel_estq_unidade = TRUE, col_rel_estq_qtd = TRUE, col_rel_estq_preco = TRUE, col_rel_estq_processo = TRUE, col_rel_estq_status = TRUE, col_rel_prod_codigo = TRUE, col_rel_prod_nome = TRUE, col_rel_prod_colecao = TRUE, col_rel_prod_preco_venda = TRUE, col_rel_prod_margem = TRUE, col_rel_prod_qtd = TRUE, col_rel_prod_status = TRUE, col_rel_cli_nome = TRUE, col_rel_cli_cnpj = TRUE, col_rel_cli_pais = TRUE, col_rel_cli_estado = TRUE, col_rel_cli_status = TRUE, col_rel_cli_dono = TRUE, col_rel_ctt_contato = TRUE, col_rel_ctt_tipo = TRUE, col_rel_ctt_empresa = TRUE, col_rel_ctt_celular = TRUE, col_rel_ctt_telefone = TRUE, col_rel_ctt_email = TRUE, col_rel_pros_nome = TRUE, col_rel_pros_email = TRUE, col_rel_pros_status = TRUE, col_rel_pros_responsavel = TRUE, col_rel_orc_codigo = TRUE, col_rel_orc_cliente = TRUE, col_rel_orc_data = TRUE, col_rel_orc_valor = TRUE, col_rel_orc_condicao = TRUE, col_rel_orc_status = TRUE, col_rel_ped_codigo = TRUE, col_rel_ped_cliente = TRUE, col_rel_ped_data = TRUE, col_rel_ped_valor = TRUE, col_rel_ped_condicao = TRUE, col_rel_ped_status = TRUE, col_rel_usr_avatar = TRUE, col_rel_usr_nome = TRUE, col_rel_usr_email = TRUE, col_rel_usr_perfil = TRUE, col_rel_usr_situacao = TRUE, col_rel_usr_status = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_tarefas SET modulo_ativo = TRUE, acao_view = TRUE, acao_create = TRUE, acao_edit = TRUE, acao_delete = TRUE, acao_assign = TRUE, acao_calendar_view = TRUE, col_tsk_titulo = TRUE, col_tsk_resp = TRUE, col_tsk_prazo = TRUE, col_tsk_status = TRUE, col_tsk_prioridade = TRUE, col_evt_titulo = TRUE, col_evt_inicio = TRUE, col_evt_fim = TRUE, col_evt_local = TRUE, col_evt_participantes = TRUE, col_evt_status = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_cfg SET modulo_ativo = TRUE, acao_view = TRUE, acao_theme_edit = TRUE, acao_integrations_edit = TRUE, acao_prefs_edit = TRUE, acao_roles_view = TRUE, acao_roles_edit = TRUE, col_role_code = TRUE, col_role_name = TRUE, col_role_desc = TRUE, col_role_modulos = TRUE, col_role_features = TRUE, col_int_nome = TRUE, col_int_status = TRUE, col_int_ult_sync = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_dashboard SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_calendario SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_lam_clientes SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_lam_servicos SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_lam_precificacao SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_lam_relatorios SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_ia SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_usuarios SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');
UPDATE perm_financeiro SET modulo_ativo = TRUE
  WHERE modelo_id IN (SELECT id FROM modelos_permissoes WHERE nome = 'Administrador');

COMMIT;
