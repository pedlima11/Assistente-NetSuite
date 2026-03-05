/**
 * Constantes centralizadas para thresholds do motor de regras fiscais.
 *
 * NENHUM magic number deve existir hardcoded nos motores (SPED ou XML).
 * Todos os thresholds de contagem, porcentagem e limites vivem aqui.
 *
 * Importado por shared/signature-stats.js, sped-rule-accumulator.js e tax-rule-generator.js.
 */

export const THRESHOLDS = {
  /** Abaixo disso, conflitos = severity 'info' (dataset pequeno demais para ser operacional) */
  MIN_ITEMS_FOR_CONFLICTS: 50,

  /** NCM precisa representar >= 10% do grupo para virar excecao */
  NCM_EXCEPTION_MIN_PERCENT: 0.10,

  /** OU >= 30 itens absolutos (para grupos grandes onde 10% e muito) */
  NCM_EXCEPTION_MIN_COUNT: 30,

  /** Filtrar clusters com menos de 5 itens (ruido) */
  NCM_CLUSTER_MIN_ITEMS: 5,

  /** Top N assinaturas no signatureSummary */
  SIGNATURE_SUMMARY_LIMIT: 10,

  /** Top N clusters no ncmClusters */
  NCM_CLUSTERS_LIMIT: 50,

  /** Cap de docKeys Set por regra (memoria) */
  DOC_TRACKING_CAP: 10000,

  /** Minimo de itens para calcular stddev de reducao BC (CST 20/51) */
  MIN_ITEMS_FOR_REDUCTION_CONFIDENCE: 30,
};
