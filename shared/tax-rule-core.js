/**
 * Logica compartilhada de agrupamento e classificacao de regras fiscais.
 *
 * Este modulo é importado tanto pelo frontend (tax-rule-generator.js)
 * quanto pelo backend (sped-rule-accumulator.js).
 * NAO deve conter dependencias de browser nem de Node.js.
 */

// ── Mapeamento: CRT do XML → Regime Fiscal FTE ─────────────────────────────
export const CRT_TO_REGIME = {
  '1': 'Optante pelo Simples Nacional',
  '2': 'Optante pelo Simples Nacional',  // excesso sublimite
  '3': null,  // Regime Normal — usuario define (Lucro Real ou Presumido)
  '4': 'Optante pelo Simples Nacional',  // MEI
};

// ── Mapeamento: tag XML do imposto → Codigo de Imposto FTE ─────────────────
export const XML_TAG_TO_TAX_CODE = {
  ICMS: 'ICMS_BR',
  ICMSST: 'ICMS_ST_BR',
  ICMS_ST: 'ICMS_ST_BR',
  ICMSDIFAL: 'ICMS_DIFAL_BR',
  FCP: 'FCP_BR',
  FCPST: 'FCP_ST_BR',
  IPI: 'IPI_BR',
  PIS: 'PIS_BR',
  COFINS: 'COFINS_BR',
  ISS: 'ISS_BR',
  ISSQN: 'ISS_BR',
  // Reforma tributaria (CBS/IBS/IS)
  CBS: 'CBS_2026_BR',
  IBS: 'IBS_2026_BR',
  IS: 'IS_2026_BR',
};

// ── NAT_BC_CRED — Tabela 4.3.7 SPED Contribuicoes ──────────────────────────
// Natureza da Base de Calculo do Credito PIS/COFINS
export const NAT_BC_CRED = {
  '01': 'Aquisição de bens para revenda',
  '02': 'Aquisição de bens utilizados como insumo',
  '03': 'Aquisição de serviços utilizados como insumo',
  '04': 'Energia elétrica e energia térmica, inclusive sob a forma de vapor',
  '05': 'Aluguéis de prédios',
  '06': 'Aluguéis de máquinas e equipamentos',
  '07': 'Armazenagem de mercadoria e frete na operação de venda',
  '08': 'Contraprestações de arrendamento mercantil',
  '09': 'Máquinas, equipamentos e outros bens incorporados ao ativo imobilizado (crédito sobre encargos de depreciação)',
  '10': 'Máquinas, equipamentos e outros bens incorporados ao ativo imobilizado (crédito sobre o valor de aquisição)',
  '11': 'Amortização e depreciação de edificações e benfeitorias em imóveis',
  '12': 'Devolução de vendas sujeitas à incidência não-cumulativa',
  '13': 'Outras operações com direito a crédito',
};

// ── CST → Tipo de Parametro FTE ─────────────────────────────────────────────
// Chave: `${taxType}_${cst}_${direction}` — direction: 'saida' | 'entrada'
export const CST_TO_PARAM_TYPE = {
  // --- ICMS (Regime Normal) ---
  ICMS_00_saida: 'CST 00 - Tributado integralmente',
  ICMS_00_entrada: 'CST 00 - Entrada com Recuperação de Crédito',
  ICMS_10_saida: 'CST 10 - Tributada e com cobrança do ICMS por substituição tributária',
  ICMS_10_entrada: 'CST 10 - Tributada e com cobrança do ICMS por substituição tributária',
  ICMS_20_saida: 'CST 20 - Com redução da base de cálculo',
  ICMS_20_entrada: 'CST 20 - Com redução da base de cálculo',
  ICMS_30_saida: 'CST 30 - Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
  ICMS_30_entrada: 'CST 30 - Isenta ou não tributada e com cobrança do ICMS por substituição tributária',
  ICMS_40_saida: 'CST 40 - Isento',
  ICMS_40_entrada: 'CST 40 - Isento',
  ICMS_41_saida: 'CST 41 - Não tributada',
  ICMS_41_entrada: 'CST 41 - Não tributada',
  ICMS_50_saida: 'CST 50 - Suspensão',
  ICMS_50_entrada: 'CST 50 - Suspensão',
  ICMS_51_saida: 'CST 51 - Diferimento',
  ICMS_51_entrada: 'CST 51 - Diferimento',
  ICMS_60_saida: 'CST 60 - Cobrado anteriormente por substituição tributária',
  ICMS_60_entrada: 'CST 60 - Cobrado anteriormente por substituição tributária',
  ICMS_70_saida: 'CST 70 - Com redução da base de cálculo e cobrança do ICMS por substituição tributária',
  ICMS_70_entrada: 'CST 70 - Com redução da base de cálculo e cobrança do ICMS por substituição tributária',
  ICMS_90_saida: 'CST 90 - Outras',
  ICMS_90_entrada: 'CST 90 - Outras',

  // --- ICMS (Simples Nacional - CSOSN) ---
  ICMS_101_saida: 'CSOSN 101 - Tributada pelo Simples Nacional com Permissão de Crédito',
  ICMS_101_entrada: 'CSOSN 101 - Tributada pelo Simples Nacional com Permissão de Crédito',
  ICMS_102_saida: 'CSOSN 102 - Tributada pelo Simples Nacional sem Permissão de Crédito',
  ICMS_102_entrada: 'CSOSN 102 - Tributada pelo Simples Nacional sem Permissão de Crédito',
  ICMS_103_saida: 'CSOSN 103 - Isenção do ICMS no Simples Nacional para Faixa de Receita Bruta',
  ICMS_103_entrada: 'CSOSN 103 - Isenção do ICMS no Simples Nacional para Faixa de Receita Bruta',
  ICMS_201_saida: 'CSOSN 201 - Tributada pelo Simples Nacional com Permissão de Crédito e com Cobrança do ICMS por Substituição Tributária',
  ICMS_201_entrada: 'CSOSN 201 - Tributada pelo Simples Nacional com Permissão de Crédito e com Cobrança do ICMS por Substituição Tributária',
  ICMS_202_saida: 'CSOSN 202 - Tributada pelo Simples Nacional sem Permissão de Crédito e com Cobrança do ICMS por Substituição Tributária',
  ICMS_202_entrada: 'CSOSN 202 - Tributada pelo Simples Nacional sem Permissão de Crédito e com Cobrança do ICMS por Substituição Tributária',
  ICMS_203_saida: 'CSOSN 203 - Isenção do ICMS no Simples Nacional para Faixa de Receita Bruta e com Cobrança do ICMS por Substituição Tributária',
  ICMS_203_entrada: 'CSOSN 203 - Isenção do ICMS no Simples Nacional para Faixa de Receita Bruta e com Cobrança do ICMS por Substituição Tributária',
  ICMS_300_saida: 'CSOSN 300 - Imune',
  ICMS_300_entrada: 'CSOSN 300 - Imune',
  ICMS_400_saida: 'CSOSN 400 - Não Tributada pelo Simples Nacional',
  ICMS_400_entrada: 'CSOSN 400 - Não Tributada pelo Simples Nacional',
  ICMS_500_saida: 'CSOSN 500 - ICMS Cobrado Anteriormente por Substituição Tributária (Substituído) ou por Antecipação',
  ICMS_500_entrada: 'CSOSN 500 - ICMS Cobrado Anteriormente por Substituição Tributária (Substituído) ou por Antecipação',
  ICMS_900_saida: 'CSOSN 900 - Outros',
  ICMS_900_entrada: 'CSOSN 900 - Outros',

  // --- PIS (saida) ---
  PIS_01_saida: 'CST 01 - Operação Tributável com Alíquota Básica',
  PIS_02_saida: 'CST 02 - Operação Tributável com Alíquota Diferenciada',
  PIS_03_saida: 'CST 03 - Operação Tributável com Alíquota por Unidade de Medida de Produto',
  PIS_04_saida: 'CST 04 - Operação Tributável Monofásica - Revenda a Alíquota Zero',
  PIS_05_saida: 'CST 05 - Operação Tributável por Substituição Tributária',
  PIS_06_saida: 'CST 06 - Operação Tributável a Alíquota Zero',
  PIS_07_saida: 'CST 07 - Operação Isenta da Contribuição',
  PIS_08_saida: 'CST 08 - Operação sem Incidência da Contribuição',
  PIS_09_saida: 'CST 09 - Operação com Suspensão da Contribuição',
  PIS_49_saida: 'CST 49 - Outras Operações de Saída',
  PIS_99_saida: 'CST 99 - Outras Saídas',
  // --- PIS (entrada) ---
  PIS_50_entrada: 'CST 50 - Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
  PIS_51_entrada: 'CST 51 - Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Não Tributada no Mercado Interno',
  PIS_52_entrada: 'CST 52 - Operação com Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação',
  PIS_53_entrada: 'CST 53 - Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
  PIS_54_entrada: 'CST 54 - Operação com Direito a Crédito - Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
  PIS_55_entrada: 'CST 55 - Operação com Direito a Crédito - Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
  PIS_56_entrada: 'CST 56 - Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação',
  PIS_60_entrada: 'CST 60 - Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
  PIS_61_entrada: 'CST 61 - Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno',
  PIS_62_entrada: 'CST 62 - Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita de Exportação',
  PIS_63_entrada: 'CST 63 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
  PIS_64_entrada: 'CST 64 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
  PIS_65_entrada: 'CST 65 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
  PIS_66_entrada: 'CST 66 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação',
  PIS_67_entrada: 'CST 67 - Crédito Presumido - Outras Operações',
  PIS_70_entrada: 'CST 70 - Operação de Aquisição sem Direito a Crédito',
  PIS_71_entrada: 'CST 71 - Operação de Aquisição com Isenção',
  PIS_72_entrada: 'CST 72 - Operação de Aquisição com Suspensão',
  PIS_73_entrada: 'CST 73 - Operação de Aquisição a Alíquota Zero',
  PIS_74_entrada: 'CST 74 - Operação de Aquisição sem Incidência da Contribuição',
  PIS_75_entrada: 'CST 75 - Operação de Aquisição por Substituição Tributária',
  PIS_98_entrada: 'CST 98 - Outras Operações de Entrada',
  PIS_99_entrada: 'CST 99 - Outras Operações',

  // --- COFINS (mesma tabela que PIS) ---
  COFINS_01_saida: 'CST 01 - Operação Tributável com Alíquota Básica',
  COFINS_02_saida: 'CST 02 - Operação Tributável com Alíquota Diferenciada',
  COFINS_03_saida: 'CST 03 - Operação Tributável com Alíquota por Unidade de Medida de Produto',
  COFINS_04_saida: 'CST 04 - Operação Tributável Monofásica - Revenda a Alíquota Zero',
  COFINS_05_saida: 'CST 05 - Operação Tributável por Substituição Tributária',
  COFINS_06_saida: 'CST 06 - Operação Tributável a Alíquota Zero',
  COFINS_07_saida: 'CST 07 - Operação Isenta da Contribuição',
  COFINS_08_saida: 'CST 08 - Operação sem Incidência da Contribuição',
  COFINS_09_saida: 'CST 09 - Operação com Suspensão da Contribuição',
  COFINS_49_saida: 'CST 49 - Outras Operações de Saída',
  COFINS_99_saida: 'CST 99 - Outras Saídas',
  COFINS_50_entrada: 'CST 50 - Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
  COFINS_51_entrada: 'CST 51 - Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Não Tributada no Mercado Interno',
  COFINS_52_entrada: 'CST 52 - Operação com Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação',
  COFINS_53_entrada: 'CST 53 - Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
  COFINS_54_entrada: 'CST 54 - Operação com Direito a Crédito - Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
  COFINS_55_entrada: 'CST 55 - Operação com Direito a Crédito - Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
  COFINS_56_entrada: 'CST 56 - Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação',
  COFINS_60_entrada: 'CST 60 - Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Tributada no Mercado Interno',
  COFINS_61_entrada: 'CST 61 - Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno',
  COFINS_62_entrada: 'CST 62 - Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita de Exportação',
  COFINS_63_entrada: 'CST 63 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno',
  COFINS_64_entrada: 'CST 64 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas no Mercado Interno e de Exportação',
  COFINS_65_entrada: 'CST 65 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação',
  COFINS_66_entrada: 'CST 66 - Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação',
  COFINS_67_entrada: 'CST 67 - Crédito Presumido - Outras Operações',
  COFINS_70_entrada: 'CST 70 - Operação de Aquisição sem Direito a Crédito',
  COFINS_71_entrada: 'CST 71 - Operação de Aquisição com Isenção',
  COFINS_72_entrada: 'CST 72 - Operação de Aquisição com Suspensão',
  COFINS_73_entrada: 'CST 73 - Operação de Aquisição a Alíquota Zero',
  COFINS_74_entrada: 'CST 74 - Operação de Aquisição sem Incidência da Contribuição',
  COFINS_75_entrada: 'CST 75 - Operação de Aquisição por Substituição Tributária',
  COFINS_98_entrada: 'CST 98 - Outras Operações de Entrada',
  COFINS_99_entrada: 'CST 99 - Outras Operações',

  // --- IPI ---
  IPI_00_entrada: 'CST 00 - Entrada com Recuperação de Crédito',
  IPI_01_entrada: 'CST 01 - Entrada Tributável com Alíquota Zero',
  IPI_02_entrada: 'CST 02 - Entrada Isenta',
  IPI_03_entrada: 'CST 03 - Entrada Não Tributada',
  IPI_04_entrada: 'CST 04 - Entrada Imune',
  IPI_05_entrada: 'CST 05 - Entrada com Suspensão',
  IPI_49_entrada: 'CST 49 - Outras',
  IPI_50_saida: 'CST 50 - Saída Tributada',
  IPI_51_saida: 'CST 51 - Saída Tributável com Alíquota Zero',
  IPI_52_saida: 'CST 52 - Saída Isenta',
  IPI_53_saida: 'CST 53 - Saída Não Tributada',
  IPI_54_saida: 'CST 54 - Saída Imune',
  IPI_55_saida: 'CST 55 - Saída com Suspensão',
  IPI_99_saida: 'CST 99 - Outras Saídas',
};

// ── Classificacao CFOP ──────────────────────────────────────────────────────

/**
 * Classifica uma operacao a partir do CFOP.
 * @param {string} cfop
 * @returns {{ direction: string, scope: string, operationType: string, itemCategory: string }}
 */
export function classifyCFOP(cfop) {
  const c = parseInt(cfop, 10);
  if (isNaN(c)) return { direction: 'desconhecido', scope: 'desconhecido', operationType: 'Outros', itemCategory: 'Outros' };

  const firstDigit = Math.floor(c / 1000);
  const subgroup = c % 1000;

  const direction = [1, 2, 3].includes(firstDigit) ? 'entrada' : 'saida';

  let scope = 'interna';
  if ([2, 6].includes(firstDigit)) scope = 'interestadual';
  if ([3, 7].includes(firstDigit)) scope = 'exterior';

  let operationType = 'Outros';
  let itemCategory = 'Mercadoria';

  if (subgroup >= 101 && subgroup <= 132) {
    operationType = direction === 'entrada' ? 'Compra' : 'Venda';
    if (subgroup === 101 || subgroup === 111 || subgroup === 116 || subgroup === 122) {
      itemCategory = 'Mercadoria Industrializacao';
    } else {
      itemCategory = 'Mercadoria';
    }
  } else if (subgroup >= 151 && subgroup <= 159) {
    operationType = 'Transferencia';
    itemCategory = 'Mercadoria';
  } else if (subgroup >= 201 && subgroup <= 209) {
    operationType = 'Devolucao';
    itemCategory = 'Mercadoria';
  } else if (subgroup >= 251 && subgroup <= 259) {
    operationType = direction === 'entrada' ? 'Compra' : 'Venda';
    itemCategory = 'Energia/Comunicacao';
  } else if (subgroup >= 301 && subgroup <= 359) {
    operationType = direction === 'entrada' ? 'Aquisicao Servico' : 'Prestacao Servico';
    itemCategory = 'Servico Transporte';
  } else if (subgroup >= 401 && subgroup <= 415) {
    operationType = direction === 'entrada' ? 'Compra' : 'Venda';
    itemCategory = 'Mercadoria ST';
  } else if (subgroup >= 451 && subgroup <= 457) {
    operationType = direction === 'entrada' ? 'Compra' : 'Venda';
    itemCategory = 'Ativo Fixo';
  } else if (subgroup >= 501 && subgroup <= 557) {
    operationType = direction === 'entrada' ? 'Compra' : 'Venda';
    itemCategory = 'Material Uso/Consumo';
  } else if (subgroup >= 551 && subgroup <= 557) {
    operationType = direction === 'entrada' ? 'Compra' : 'Venda';
    itemCategory = 'Ativo Fixo';
  } else if (subgroup >= 901 && subgroup <= 949) {
    operationType = 'Remessa/Retorno';
    itemCategory = 'Outros';
  } else if (subgroup >= 933 && subgroup <= 933) {
    operationType = direction === 'entrada' ? 'Aquisicao Servico' : 'Prestacao Servico';
    itemCategory = 'Servico';
  }

  return { direction, scope, operationType, itemCategory };
}

/**
 * Infere a Linha de Negocio a partir do CFOP.
 */
export function inferLOB(cfop) {
  const { itemCategory } = classifyCFOP(cfop);
  if (itemCategory.includes('Servico')) return 'Prestação de Serviços';
  if (itemCategory === 'Mercadoria Industrializacao') return 'Fabricação Industrial';
  if (itemCategory === 'Energia/Comunicacao') return 'Prestação de Serviços de Aluguel, Frete, Utilidade Pública ou Telecomunicação';
  return 'Venda de Mercadorias';
}

/**
 * Gera nome descritivo para a regra.
 */
export function generateRuleName({ operationType, itemCategory, emitUF, destUF, ufEmissor, ufDestinatario, regimeEmissor }) {
  const op = operationType || 'Operacao';
  const cat = itemCategory || 'Mercadoria';
  const uf1 = emitUF || ufEmissor || '??';
  const uf2 = destUF || ufDestinatario || '??';
  const regime = regimeEmissor || '';
  const suffix = regime ? ` pelo ${regime}` : '';
  return `${op} de ${cat} de ${uf1} para ${uf2}${suffix}`;
}

// ── Regime ──────────────────────────────────────────────────────────────────

/**
 * Resolve o regime fiscal do emitente a partir do CRT.
 */
export function resolveRegime(crt, defaultRegime) {
  const mapped = CRT_TO_REGIME[crt];
  if (mapped) return mapped;
  return defaultRegime || 'Lucro Real';
}

// ── Chave de agrupamento ────────────────────────────────────────────────────

/**
 * Normaliza CFOP removendo tudo que nao e digito.
 * Deve ser chamado uma vez e persistido no item (item.cfopNormalized).
 *
 * @param {string} cfop
 * @returns {string} CFOP normalizado (ex: "1556") ou original se vazio
 */
export function normalizeCFOP(cfop) {
  if (!cfop) return '';
  return cfop.replace(/\D/g, '');
}

/**
 * Gera a chave de agrupamento primaria para uma regra.
 *
 * Key: direction + emitUF + destUF + cfop + operationType
 *
 * - direction evita misturar entradas/saidas no mesmo bucket
 * - emitUF separa rotas de UFs emissoras diferentes (mesmo CFOP)
 * - destUF quase constante para entradas (UF do declarante)
 * - cfop ja normalizado (4 digitos sem pontos)
 * - operationType classificado pelo CFOP
 *
 * @param {Object} item - Item fiscal parseado (deve ter cfopNormalized ou cfop)
 * @param {Object} [config] - Nao usado no MVP, mantido para compatibilidade
 */
export function makeRuleKey(item, config) {
  const cfop = item.cfopNormalized || normalizeCFOP(item.cfop);
  const { direction, operationType } = classifyCFOP(cfop);
  const emitUF = (item.emitUF || '').toUpperCase();
  const destUF = (item.destUF || '').toUpperCase();

  return [direction, emitUF, destUF, cfop, operationType].join('|');
}

// ── Tipo canonico de imposto ─────────────────────────────────────────────────
// XML usa 'ICMSST', SPED usa 'ICMS_ST' para o mesmo imposto.
// Sem normalizacao, assinaturas divergem: ICMSST:60:0.0000 vs ICMS_ST:60:0.0000

/** Mapa type → forma canonica (elimina variantes XML vs SPED) */
export const CANONICAL_TAX_TYPE = {
  ICMS: 'ICMS', ICMSST: 'ICMS_ST', ICMS_ST: 'ICMS_ST',
  ICMSDIFAL: 'ICMS_DIFAL', FCP: 'FCP', FCPST: 'FCP_ST',
  IPI: 'IPI', PIS: 'PIS', COFINS: 'COFINS',
  ISS: 'ISS', ISSQN: 'ISS',
  CBS: 'CBS', IBS: 'IBS', IS: 'IS',
};

// ── Taxes passivos ──────────────────────────────────────────────────────────

/**
 * CSTs de ICMS passivos: nao geram determinacao ativa nem conflito de aliquota.
 * - 60: ST cobrada anteriormente
 * - 40: isento
 * - 41: nao tributada
 * - 50: suspensao
 */
export const PASSIVE_ICMS_CST = new Set(['60', '40', '41', '50']);

/**
 * Retorna true se o tax e passivo (ICMS com CST informativo, ou ICMS_ST marcado como _passive).
 * Passivos NAO devem:
 *   - gerar determinacao
 *   - participar de conflict detection (rate conflicts)
 *   - participar da activeSignature
 * Passivos DEVEM:
 *   - participar da structuralSignature (detectar heterogeneidade)
 *   - ser preservados como metadado informativo (_passiveTaxes)
 */
export function isPassiveTax(tax) {
  const type = CANONICAL_TAX_TYPE[tax.type] || tax.type;
  if (type === 'ICMS' && PASSIVE_ICMS_CST.has(tax.cst)) return true;
  if (type === 'ICMS_ST' && tax._passive) return true;
  return false;
}

/**
 * Retorna o ICMS ativo de um item, ou null se nenhum.
 * Usa isPassiveTax() como unica fonte de verdade.
 * @param {Object[]} taxes
 * @returns {Object|null}
 */
export function getActiveIcmsTax(taxes) {
  if (!taxes) return null;
  return taxes.find(t => {
    const ct = CANONICAL_TAX_TYPE[t.type] || (t.type || '').toUpperCase();
    return ct === 'ICMS' && !isPassiveTax(t);
  }) || null;
}

// ── Tax signatures ──────────────────────────────────────────────────────────

/**
 * Gera assinatura normalizada de imposto para deteccao de padroes/excecoes.
 * Formato: "TYPE:CST:ALIQ.NNNN" ou "TYPE:CST:ALIQ.NNNN:NAT"
 *
 * Normalizacoes:
 * - type: CANONICAL_TAX_TYPE (ICMSST → ICMS_ST, ISSQN → ISS, etc.)
 * - CST: padStart(2,'0') para CST<=2 digitos, manter 3 para CSOSN, manter >3 para cClassTrib
 * - aliq: toFixed(4) — sempre 4 casas decimais
 * - CBS/IBS: usam cClassTrib como eixo, nao CST
 *
 * Sort por string e deterministico com formato fixo TYPE:CST:ALIQ.NNNN.
 *
 * @param {Object} tax
 * @param {Object} [opts]
 * @param {boolean} [opts.includeNatBcCred=false] - Incluir NAT_BC_CRED na assinatura (PIS/COFINS do Contrib)
 */
export function makeTaxSignature(tax, opts = {}) {
  const rawType = (tax.type || '').trim();
  const type = CANONICAL_TAX_TYPE[rawType] || rawType.toUpperCase();

  // CBS/IBS usam cClassTrib como eixo de classificacao, nao CST
  const classif = (type === 'CBS' || type === 'IBS')
    ? (tax.cClassTrib || tax.cst || '')
    : (tax.cst || '');

  // CST: normalizar por comprimento (sem heuristica >=100)
  const cstRaw = String(classif).trim();
  const cstNorm = cstRaw.length === 3 ? cstRaw            // CSOSN: manter 3
    : cstRaw.length <= 2 ? cstRaw.padStart(2, '0')        // CST: pad 2
    : cstRaw;                                              // cClassTrib (6+): manter

  // Aliq: sempre 4 casas decimais
  const aliqNorm = Number(tax.aliq || 0).toFixed(4);

  let sig = `${type}:${cstNorm}:${aliqNorm}`;
  if (opts.includeNatBcCred && tax.natBcCred) {
    sig += `:${tax.natBcCred}`;
  }
  return sig;
}

// ── Resolucao de parametros ─────────────────────────────────────────────────

/**
 * Heuristica de sugestao de paramType para CBS/IBS baseada em cClassTrib.
 * NAO e mapeamento definitivo — o match final depende das opcoes reais
 * encontradas no ambiente via findBestNSMatch().
 */
export function resolveParamTypeCBS(cClassTrib, taxType, direction) {
  if (!cClassTrib) return null;
  // Usar codigo completo (6 digitos) para match contra opcoes reais do NetSuite.
  // findBestNSMatch resolve o match final via partial/prefix.
  return `cClassTrib ${cClassTrib}`;
}

/**
 * Resolve o Tipo de Parametro FTE a partir do tipo de imposto, CST e direcao.
 * Para CBS/IBS, delega para resolveParamTypeCBS usando cClassTrib.
 *
 * @param {string} taxType
 * @param {string} cst
 * @param {string} direction - 'entrada' | 'saida'
 * @param {string} [cClassTrib] - codigo de classificacao tributaria (CBS/IBS)
 */
export function resolveParamType(taxType, cst, direction, cClassTrib) {
  // CBS/IBS usam cClassTrib; fallback para CST que e o mesmo codigo de classificacao
  if (taxType === 'CBS' || taxType === 'IBS') {
    const classCode = cClassTrib || cst;
    if (classCode) return resolveParamTypeCBS(classCode, taxType, direction);
    return null;
  }
  const key = `${taxType}_${cst}_${direction}`;
  if (CST_TO_PARAM_TYPE[key]) return CST_TO_PARAM_TYPE[key];
  const opposite = direction === 'entrada' ? 'saida' : 'entrada';
  return CST_TO_PARAM_TYPE[`${taxType}_${cst}_${opposite}`] || null;
}

/**
 * Normaliza string para comparacao: minusculas, sem acentos, trim.
 */
function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Encontra o melhor match para um nome de parametro sugerido
 * na lista real de param types vindos do NetSuite.
 */
export function findBestNSMatch(suggestion, nsParamTypes) {
  if (!suggestion || !nsParamTypes || nsParamTypes.length === 0) return suggestion;

  const exact = nsParamTypes.find(pt => pt.name === suggestion);
  if (exact) return exact.name;

  const normSugg = normalize(suggestion);
  const normExact = nsParamTypes.find(pt => normalize(pt.name) === normSugg);
  if (normExact) return normExact.name;

  // cClassTrib: match por codigo completo (ex: "cClassTrib 410014" → "cClassTrib 410014 - Descricao")
  const cctMatch = suggestion.match(/^cClassTrib\s+(\d+)/i);
  if (cctMatch) {
    const cctCode = cctMatch[1];
    const cctCandidate = nsParamTypes.find(pt => {
      const m = pt.name.match(/^cClassTrib\s+(\d+)/i);
      return m && m[1] === cctCode;
    });
    if (cctCandidate) return cctCandidate.name;
  }

  const cstMatch = suggestion.match(/^(C(?:ST|SOSN)\s+\d+)/i);
  if (cstMatch) {
    const prefix = normalize(cstMatch[1]);
    const candidates = nsParamTypes.filter(pt => normalize(pt.name).startsWith(prefix));
    if (candidates.length === 1) return candidates[0].name;
    if (candidates.length > 1) {
      const descPart = normalize(suggestion.replace(cstMatch[0], '').replace(/^\s*-\s*/, ''));
      const best = candidates.find(pt => {
        const ptDesc = normalize(pt.name).replace(prefix, '').replace(/^\s*-\s*/, '');
        return ptDesc.includes(descPart.substring(0, 12)) || descPart.includes(ptDesc.substring(0, 12));
      });
      if (best) return best.name;
      return candidates[0].name;
    }
  }

  const partialMatch = nsParamTypes.find(pt => {
    const normPt = normalize(pt.name);
    return normPt.includes(normSugg) || normSugg.includes(normPt);
  });
  if (partialMatch) return partialMatch.name;

  return suggestion;
}

/**
 * Versao tipada de findBestNSMatch que distingue match real de fallback.
 *
 * @param {string|null} suggestion - Sugestao do resolveParamType
 * @param {Object[]} nsParamTypes - Lista real do NetSuite ({ name, ... })
 * @returns {{ value: string, matched: boolean, matchType: 'exact'|'normalized'|'cClassTrib'|'cst_prefix'|'partial'|'none' }}
 */
export function findBestNSMatchSafe(suggestion, nsParamTypes) {
  if (!suggestion) return { value: '', matched: false, matchType: 'none' };
  if (!nsParamTypes || nsParamTypes.length === 0) return { value: suggestion, matched: false, matchType: 'none' };

  // Exact
  const exact = nsParamTypes.find(pt => pt.name === suggestion);
  if (exact) return { value: exact.name, matched: true, matchType: 'exact' };

  // Normalized exact
  const normSugg = normalize(suggestion);
  const normExact = nsParamTypes.find(pt => normalize(pt.name) === normSugg);
  if (normExact) return { value: normExact.name, matched: true, matchType: 'normalized' };

  // cClassTrib code match
  const cctMatch = suggestion.match(/^cClassTrib\s+(\d+)/i);
  if (cctMatch) {
    const cctCode = cctMatch[1];
    const cctCandidate = nsParamTypes.find(pt => {
      const m = pt.name.match(/^cClassTrib\s+(\d+)/i);
      return m && m[1] === cctCode;
    });
    if (cctCandidate) return { value: cctCandidate.name, matched: true, matchType: 'cClassTrib' };
  }

  // CST prefix match
  const cstMatch = suggestion.match(/^(C(?:ST|SOSN)\s+\d+)/i);
  if (cstMatch) {
    const prefix = normalize(cstMatch[1]);
    const candidates = nsParamTypes.filter(pt => normalize(pt.name).startsWith(prefix));
    if (candidates.length === 1) return { value: candidates[0].name, matched: true, matchType: 'cst_prefix' };
    if (candidates.length > 1) {
      const descPart = normalize(suggestion.replace(cstMatch[0], '').replace(/^\s*-\s*/, ''));
      const best = candidates.find(pt => {
        const ptDesc = normalize(pt.name).replace(prefix, '').replace(/^\s*-\s*/, '');
        return ptDesc.includes(descPart.substring(0, 12)) || descPart.includes(ptDesc.substring(0, 12));
      });
      if (best) return { value: best.name, matched: true, matchType: 'cst_prefix' };
      return { value: candidates[0].name, matched: true, matchType: 'cst_prefix' };
    }
  }

  // Partial
  const partialMatch = nsParamTypes.find(pt => {
    const normPt = normalize(pt.name);
    return normPt.includes(normSugg) || normSugg.includes(normPt);
  });
  if (partialMatch) return { value: partialMatch.name, matched: true, matchType: 'partial' };

  // No match
  return { value: suggestion, matched: false, matchType: 'none' };
}

// ── Helpers de formatacao ───────────────────────────────────────────────────

/**
 * Formata CFOP de "5102" para "5.102".
 */
export function formatCFOP(cfop) {
  if (!cfop || cfop.length < 4) return cfop || '';
  const raw = cfop.replace(/\./g, '');
  return raw[0] + '.' + raw.substring(1);
}

/**
 * Formata data ISO para DD/MM/AAAA.
 */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = isoDate.substring(0, 10);
  const [year, month, day] = d.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

/**
 * Normaliza CNPJ removendo pontuacao.
 */
export function normalizeCnpj(cnpj) {
  return (cnpj || '').replace(/[.\-\/]/g, '').trim();
}

/**
 * Determina a direcao (entrada/saida) comparando CNPJ do emitente
 * com o CNPJ da subsidiaria. Fallback pelo CFOP.
 */
export function getDirection(cfop, emitCNPJ, subsidiaryCnpj) {
  if (subsidiaryCnpj && emitCNPJ) {
    const normSub = normalizeCnpj(subsidiaryCnpj);
    const normEmit = normalizeCnpj(emitCNPJ);
    if (normSub && normEmit) {
      return normEmit === normSub ? 'saida' : 'entrada';
    }
  }
  const first = parseInt(cfop?.[0], 10);
  return [1, 2, 3].includes(first) ? 'entrada' : 'saida';
}

// ── Rule Group Key ──────────────────────────────────────────────────────────

/**
 * Gera chave de agrupamento para UI: direction|cfop|emitUF|destUF
 * Ambos motores (SPED e XML) usam esta funcao.
 *
 * @param {string} cfop
 * @param {string} emitUF
 * @param {string} destUF
 * @returns {string}
 */
export function buildRuleGroupKey(cfop, emitUF, destUF) {
  const { direction } = classifyCFOP(cfop);
  return `${direction}|${normalizeCFOP(cfop)}|${(emitUF || '').toUpperCase()}|${(destUF || '').toUpperCase()}`;
}

// ── Conflict schema ─────────────────────────────────────────────────────────

/**
 * Schema unico de conflict. Ambos motores DEVEM gerar conflicts neste formato.
 *
 * conflictType: 'rate' | 'structural' | 'passive_active'
 * severity: 'warning' (operacional) | 'info' (dataset pequeno)
 *
 * @param {string} taxType - Tipo de imposto (ex: 'ICMS', 'PIS')
 * @param {string} conflictType - 'rate' | 'structural' | 'passive_active'
 * @param {string} severity - 'warning' | 'info'
 * @param {Object} detail - Dados adicionais do conflito
 * @param {string[]} [signatures] - Assinaturas envolvidas
 * @returns {{ taxType: string, conflictType: string, severity: string, detail: Object, signatures: string[] }}
 */
export function buildConflict(taxType, conflictType, severity, detail, signatures = []) {
  return { taxType, conflictType, severity, detail, signatures };
}
