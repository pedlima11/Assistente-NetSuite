/**
 * Exportador de regras fiscais no formato do template
 * "160. Determinacao de Impostos.xlsx" do NetSuite.
 *
 * Gera um XLSX com 3 sheets usando SheetJS (xlsx), ja instalado no projeto.
 * O arquivo gerado pode ser importado diretamente no NetSuite via CSV Import.
 */

import * as XLSX from 'xlsx';

// ── Cabecalhos exatos do template 160 ───────────────────────────────────────

const RULE_HEADERS = [
  'ID EXTERNO',
  'NOME',
  'REGISTRO PAI DE REGRAS DE DETERMINAÇÃO DE IMPOSTOS',
  'SUBSIDIÁRIA',
  'CÓDIGO DA OPERAÇÃO',
  'CÓDIGO DO ITEM',
  'ESTADO DO EMISSOR',
  'ESTADO DO DESTINATÁRIO',
  'CIDADE DO EMISSOR',
  'CIDADE DO DESTINATÁRIO',
  'PAÍS DO EMISSOR',
  'PAÍS DO DESTINATÁRIO',
  'VÁLIDO A PARTIR DE',
  'VÁLIDO ATÉ',
  'REGIME FISCAL DO EMISSOR',
  'REGIME FISCAL DO DESTINATÁRIO',
  'LINHA DE NEGÓCIOS DO EMISSOR',
  'LINHA DE NEGÓCIOS DO DESTINATÁRIO',
];

const DETERMINATION_HEADERS = [
  'ID EXTERNO',
  'REGRA DE DETERMINAÇÃO DE IMPOSTOS',
  'ALÍQUOTA',
  'VÁLIDO A PARTIR DE ',  // nota: espaco no final (igual ao template original)
  'VÁLIDO ATÉ',
  'CÓDIGO DE IMPOSTO ',   // nota: espaco no final
  'TIPO DE PARÂMETRO',
  'VALOR DO PARÂMETRO',
  'VALOR DO ABATIMENTO',
];

// ── Conversao de dados para linhas do XLSX ──────────────────────────────────

/**
 * Converte uma regra para uma linha do sheet "Regra de Impostos".
 */
function ruleToRow(rule) {
  return [
    rule.externalId,
    rule.name,
    rule.parent || '',
    rule.subsidiary || '',
    rule.cfop || '',
    rule.ncm || '',
    rule.ufEmissor || '',
    rule.ufDestinatario || '',
    rule.cidadeEmissor || '',
    rule.cidadeDestinatario || '',
    rule.paisEmissor || 'BR',
    rule.paisDestinatario || 'BR',
    rule.validoAPartirDe || '',
    rule.validoAte || '',
    rule.regimeEmissor || '',
    rule.regimeDestinatario || '',
    rule.lobEmissor || '',
    rule.lobDestinatario || '',
  ];
}

/**
 * Converte uma determinacao para uma linha do sheet "Determinacao de Impostos".
 */
function determinationToRow(det) {
  return [
    det.externalId,
    det.ruleExternalId,
    det.aliquota != null ? det.aliquota : '',
    det.validoAPartirDe || '',
    det.validoAte || '',
    det.codigoImposto || '',
    det.tipoParametro || '',
    det.valorParametro || '',
    det.valorAbatimento || '',
  ];
}

// ── Resumo sheet builder ─────────────────────────────────────────────────

/**
 * Constroi dados da sheet Resumo com estatisticas expandidas.
 *
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @param {Object} stats
 * @returns {Array[]} AOA para XLSX
 */
function buildSummaryData(rules, determinations, stats) {
  const rows = [
    ['Resumo da Geracao de Regras Fiscais'],
    [],
    ['Metrica', 'Valor'],
    ['Total de itens processados', stats?.totalItems || 0],
    ['Grupos unicos (cenarios)', stats?.totalGroups || 0],
    ['Regras genericas', stats?.genericRules || 0],
    ['Regras de excecao (por NCM)', stats?.exceptionRules || 0],
    ['Total de regras', rules.length],
    ['Total de determinacoes', determinations.length],
  ];

  // ── Contagem de unresolvedParam ──────────────────────────────────────
  const unresolvedCount = determinations.filter(d => d._unresolvedParam).length;
  if (unresolvedCount > 0) {
    rows.push(['Determinacoes com parametro nao resolvido', unresolvedCount]);
  }

  // ── Confidence score medio ───────────────────────────────────────────
  const scores = rules.map(r => r.confidenceScore).filter(s => s != null && s > 0);
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    rows.push(['Confianca media das regras', `${avg.toFixed(1)}%`]);
  }

  // ── Regras com conflito ──────────────────────────────────────────────
  const conflictCount = rules.filter(r => r.hasConflict).length;
  if (conflictCount > 0) {
    rows.push(['Regras com multi-assinatura (conflito)', conflictCount]);
  }

  // ── Passive taxes info ───────────────────────────────────────────────
  const rulesWithPassive = rules.filter(r => r._passiveTaxes?.length > 0);
  if (rulesWithPassive.length > 0) {
    rows.push([]);
    rows.push(['Impostos Passivos (informativo — nao geram determinacao)']);
    rows.push(['Regra', 'Tipo', 'CST', 'Aliquota']);
    for (const rule of rulesWithPassive) {
      for (const pt of rule._passiveTaxes) {
        rows.push([rule.externalId, pt.type || '', pt.cst || '', pt.aliq != null ? pt.aliq : '']);
      }
    }
  }

  // ── Distribuicao por ruleGroupKey ────────────────────────────────────
  const groupKeyMap = new Map();
  for (const rule of rules) {
    if (!rule._ruleGroupKey) continue;
    const key = rule._ruleGroupKey;
    if (!groupKeyMap.has(key)) groupKeyMap.set(key, { count: 0, items: 0 });
    const entry = groupKeyMap.get(key);
    entry.count++;
    entry.items += rule.ruleStats?.items || 0;
  }
  if (groupKeyMap.size > 0) {
    rows.push([]);
    rows.push(['Distribuicao por Grupo de Regras']);
    rows.push(['Grupo (direcao|cfop|ufEmit|ufDest)', 'Regras', 'Itens']);
    const sorted = [...groupKeyMap.entries()].sort((a, b) => b[1].items - a[1].items);
    for (const [key, data] of sorted.slice(0, 50)) {
      rows.push([key, data.count, data.items]);
    }
  }

  rows.push([]);
  rows.push(['Gerado em', new Date().toLocaleString('pt-BR')]);
  rows.push(['Formato', 'Template 160 - Determinacao de Impostos']);

  return rows;
}

// ── Detalhes NCM sheet builder ──────────────────────────────────────────

const NCM_DETAILS_MAX_ROWS = 10000;
const NCM_CLUSTERS_PER_RULE = 50;

/**
 * Constroi dados da sheet Detalhes NCM com clusters de cada regra pai.
 *
 * @param {Object[]} rules
 * @returns {Array[]} AOA para XLSX (header + dados). Retorna [header] se nenhum cluster.
 */
function buildNcmDetailsData(rules) {
  const header = [
    'ID Regra', 'Nome Regra', 'NCM', 'Itens',
    'Valor Total', 'Assinatura Dominante', '% Dominante', 'Conflito',
  ];
  const rows = [header];

  for (const rule of rules) {
    if (!rule.ncmClusters?.length) continue;
    const clusters = rule.ncmClusters.slice(0, NCM_CLUSTERS_PER_RULE);
    for (const c of clusters) {
      if (rows.length > NCM_DETAILS_MAX_ROWS) break;
      rows.push([
        rule.externalId || '',
        rule.name || '',
        c.ncm || '',
        c.itemCount || 0,
        c.totalValue || 0,
        c.dominantSignature || '',
        c.dominantPercent != null ? `${c.dominantPercent}%` : '',
        c.hasConflict ? 'Sim' : 'Nao',
      ]);
    }
    if (rows.length > NCM_DETAILS_MAX_ROWS) break;
  }

  return rows;
}

// ── API publica ─────────────────────────────────────────────────────────────

/**
 * Gera um workbook XLSX no formato do template 160.
 *
 * @param {Object[]} rules - Array de TaxRule
 * @param {Object[]} determinations - Array de TaxDetermination
 * @param {Object} stats - Estatisticas da geracao
 * @returns {Blob} Blob do arquivo XLSX
 */
export function exportToXLSX(rules, determinations, stats) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Regra de Impostos ──────────────────────────────────────────
  const ruleData = [RULE_HEADERS, ...rules.map(ruleToRow)];
  const ruleSheet = XLSX.utils.aoa_to_sheet(ruleData);

  // Ajustar largura das colunas
  ruleSheet['!cols'] = [
    { wch: 15 },  // ID EXTERNO
    { wch: 55 },  // NOME
    { wch: 15 },  // REGISTRO PAI
    { wch: 25 },  // SUBSIDIARIA
    { wch: 10 },  // CODIGO OPERACAO
    { wch: 15 },  // CODIGO ITEM
    { wch: 8 },   // UF EMISSOR
    { wch: 8 },   // UF DESTINATARIO
    { wch: 25 },  // CIDADE EMISSOR
    { wch: 25 },  // CIDADE DESTINATARIO
    { wch: 10 },  // PAIS EMISSOR
    { wch: 10 },  // PAIS DESTINATARIO
    { wch: 15 },  // VALIDO A PARTIR DE
    { wch: 15 },  // VALIDO ATE
    { wch: 25 },  // REGIME EMISSOR
    { wch: 25 },  // REGIME DESTINATARIO
    { wch: 30 },  // LOB EMISSOR
    { wch: 30 },  // LOB DESTINATARIO
  ];

  XLSX.utils.book_append_sheet(wb, ruleSheet, 'Regra de Impostos');

  // ── Sheet 2: Determinacao de Impostos ───────────────────────────────────
  const detData = [DETERMINATION_HEADERS, ...determinations.map(determinationToRow)];
  const detSheet = XLSX.utils.aoa_to_sheet(detData);

  detSheet['!cols'] = [
    { wch: 15 },  // ID EXTERNO
    { wch: 55 },  // REGRA DE DETERMINACAO
    { wch: 10 },  // ALIQUOTA
    { wch: 15 },  // VALIDO A PARTIR DE
    { wch: 15 },  // VALIDO ATE
    { wch: 30 },  // CODIGO DE IMPOSTO
    { wch: 60 },  // TIPO DE PARAMETRO
    { wch: 20 },  // VALOR DO PARAMETRO
    { wch: 20 },  // VALOR DO ABATIMENTO
  ];

  XLSX.utils.book_append_sheet(wb, detSheet, 'Determinação de Impostos');

  // ── Sheet 3: Resumo ─────────────────────────────────────────────────────
  const summaryData = buildSummaryData(rules, determinations, stats);
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 40 }, { wch: 25 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Resumo');

  // ── Sheet 4: Detalhes NCM ─────────────────────────────────────────────
  const ncmData = buildNcmDetailsData(rules);
  if (ncmData.length > 1) {
    const ncmSheet = XLSX.utils.aoa_to_sheet(ncmData);
    ncmSheet['!cols'] = [
      { wch: 15 },  // ID Regra
      { wch: 50 },  // Nome Regra
      { wch: 12 },  // NCM
      { wch: 10 },  // Itens
      { wch: 15 },  // Valor Total
      { wch: 60 },  // Assinatura Dominante
      { wch: 12 },  // % Dominante
      { wch: 12 },  // Conflito
    ];
    XLSX.utils.book_append_sheet(wb, ncmSheet, 'Detalhes NCM');
  }

  // Gerar Blob
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Gera e dispara o download do arquivo XLSX.
 *
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @param {Object} stats
 * @param {string} [filename] - Nome do arquivo (default: 'regras_fiscais_YYYYMMDD.xlsx')
 */
export function downloadXLSX(rules, determinations, stats, filename) {
  const blob = exportToXLSX(rules, determinations, stats);

  const defaultName = `regras_fiscais_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
  const name = filename || defaultName;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Gera e dispara download de CSV separados (alternativa ao XLSX).
 * Gera 2 arquivos: regras.csv e determinacoes.csv
 */
export function downloadCSVs(rules, determinations) {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // CSV Regras
  const ruleCsv = [
    RULE_HEADERS.join(';'),
    ...rules.map(r => ruleToRow(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')),
  ].join('\n');

  downloadBlob(
    new Blob(['\ufeff' + ruleCsv], { type: 'text/csv;charset=utf-8' }),
    `regras_impostos_${timestamp}.csv`
  );

  // CSV Determinacoes
  const detCsv = [
    DETERMINATION_HEADERS.join(';'),
    ...determinations.map(d => determinationToRow(d).map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')),
  ].join('\n');

  setTimeout(() => {
    downloadBlob(
      new Blob(['\ufeff' + detCsv], { type: 'text/csv;charset=utf-8' }),
      `determinacao_impostos_${timestamp}.csv`
    );
  }, 500);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
