/**
 * Warning Translator — converte reason codes internos em mensagens para leigos.
 *
 * Cada aviso tem: title, happened, impact, action, severity, blocking.
 * Termos tecnicos (CST, paramType, signature) ficam escondidos em "Detalhes tecnicos".
 */

const WARNINGS = {
  // ── Conflitos ───────────────────────────────────────────────────────────────

  RATE_CONFLICT: {
    title: 'Mesma operacao aparece com imposto diferente',
    happened: 'Para a mesma rota e CFOP, o arquivo mostra mais de uma tributacao (ex: aliquota {aliqA}% e {aliqB}%).',
    impact: 'O sistema nao pode escolher automaticamente sem arriscar criar regra errada. Essa regra precisa de decisao humana.',
    action: 'Escolha uma das opcoes como "principal" ou crie excecao por NCM/fornecedor conforme a evidencia.',
    severity: 'ERROR',
    blocking: true,
  },

  STRUCTURAL_CONFLICT: {
    title: 'Variacao na estrutura tributaria',
    happened: 'Alguns itens desta operacao tem substituicao tributaria (ST) e outros nao ({withST} com ST, {withoutST} sem ST).',
    impact: 'Pode ser necessario separar em regras diferentes (com e sem ST).',
    action: 'Revise a evidencia e decida se precisa criar excecao.',
    severity: 'WARN',
    blocking: false,
  },

  // ── Parametros / Configuracao ──────────────────────────────────────────────

  PARAMTYPE_MISSING: {
    title: 'Falta configuracao no NetSuite',
    happened: 'O arquivo indica {taxType} em algumas operacoes, mas o NetSuite nao tem o "tipo de parametro" correspondente configurado.',
    impact: 'Voce consegue revisar e exportar para Excel, mas nao consegue criar essa regra no NetSuite ainda.',
    action: 'Ajustar o mapeamento de parametros ou marcar para revisao manual.',
    severity: 'ERROR',
    blocking: true,
  },

  PARAMTYPE_NO_SUGGESTION: {
    title: 'Tipo de parametro nao identificado automaticamente',
    happened: 'O sistema nao conseguiu sugerir um tipo de parametro para {taxType}.',
    impact: 'A regra sera exportada sem tipo de parametro. Sera necessario preencher manualmente.',
    action: 'Preencha o tipo de parametro manualmente no campo correspondente.',
    severity: 'WARN',
    blocking: false,
  },

  PARAMTYPE_NO_ENV_MATCH: {
    title: 'Tipo de parametro nao encontrado no ambiente NetSuite',
    happened: 'O tipo sugerido "{suggestedParam}" nao existe no ambiente NetSuite conectado.',
    impact: 'A regra sera criada com o tipo sugerido, mas pode falhar na importacao.',
    action: 'Verifique se o tipo de parametro existe no seu NetSuite ou ajuste manualmente.',
    severity: 'WARN',
    blocking: false,
  },

  // ── Dados passivos / informativos ─────────────────────────────────────────

  PASSIVE_TAX_INFO: {
    title: 'ICMS ja foi recolhido antes (informacao do arquivo)',
    happened: 'O arquivo traz ICMS com situacao "{cstLabel}" (CST {cst}). Isso e informacao historica, nao uma cobranca nova.',
    impact: 'Nao vira regra ativa. Usamos apenas como referencia.',
    action: 'Nenhuma acao necessaria (a menos que voce queira auditar).',
    severity: 'INFO',
    blocking: false,
  },

  // ── Dados do arquivo ──────────────────────────────────────────────────────

  EMIT_UF_MISSING: {
    title: 'Origem do fornecedor nao encontrada',
    happened: 'Algumas linhas nao trazem o estado (UF) do fornecedor.',
    impact: 'Nao da para classificar a operacao por "de qual estado para qual estado". Essa linha nao entra nas regras automaticas.',
    action: 'Complete/ajuste o cadastro do participante no SPED (ou informe a UF do fornecedor no cadastro) e reprocesse.',
    severity: 'WARN',
    blocking: false,
  },

  INVALID_CFOP: {
    title: 'CFOP invalido no arquivo',
    happened: 'Encontramos CFOP com formato invalido (ex: letras ou menos de 4 digitos).',
    impact: 'Nao conseguimos classificar a operacao. A linha fica fora das regras.',
    action: 'Corrigir o CFOP no SPED (ou identificar o registro errado) e reprocessar.',
    severity: 'WARN',
    blocking: false,
  },

  NO_TAX_DATA: {
    title: 'Linha sem dados fiscais',
    happened: 'Essa linha do arquivo nao contem nenhum imposto reconhecido.',
    impact: 'A linha nao entra nas regras automaticas.',
    action: 'Verificar se e esperado ou se o arquivo esta incompleto.',
    severity: 'INFO',
    blocking: false,
  },

  NO_NCM: {
    title: 'NCM ausente no cadastro de itens',
    happened: 'O item nao tem NCM no registro 0200 do SPED.',
    impact: 'Nao sera possivel criar excecoes por NCM para esse item.',
    action: 'Atualizar o cadastro de itens com o NCM correto.',
    severity: 'INFO',
    blocking: false,
  },

  NO_PARTICIPANT: {
    title: 'Participante nao encontrado no cadastro',
    happened: 'O documento referencia um participante que nao existe no registro 0150 do SPED.',
    impact: 'Nao e possivel determinar o fornecedor. A linha fica fora das regras.',
    action: 'Verificar se o registro 0150 esta completo no SPED.',
    severity: 'WARN',
    blocking: false,
  },

  NO_CFOP: {
    title: 'CFOP ausente na linha',
    happened: 'Essa linha do arquivo nao tem CFOP preenchido.',
    impact: 'Sem CFOP nao e possivel classificar a operacao. A linha fica fora das regras.',
    action: 'Corrigir o arquivo de origem e reprocessar.',
    severity: 'WARN',
    blocking: false,
  },

  // ── Needs Review (SPED) ────────────────────────────────────────────────────

  NEEDS_REVIEW: {
    title: 'Item precisa de revisao manual',
    happened: 'Esse item foi aceito parcialmente mas tem dados incompletos ou ambiguos.',
    impact: 'O item nao foi incluido nas regras automaticas.',
    action: 'Revise os dados originais e corrija o que for necessario.',
    severity: 'WARN',
    blocking: false,
  },

  // ── Analise estatistica ──────────────────────────────────────────────────────

  MULTI_SIGNATURE: {
    title: 'Operacao com mais de uma tributacao',
    happened: 'Itens tributados de formas diferentes (confianca {confidence}%).',
    impact: 'Regra foi criada pela tributacao principal, mas pode haver excecoes.',
    action: 'Verificar distribuicao de assinaturas e decidir se precisa excecoes por NCM.',
    severity: 'WARN',
    blocking: false,
  },

  LOW_CONFIDENCE: {
    title: 'Baixa consistencia na operacao',
    happened: 'Apenas {confidence}% dos itens seguem a mesma tributacao.',
    impact: 'Alta chance de erro no arquivo ou excecoes reais.',
    action: 'Analisar NCMs com tributacao diferente.',
    severity: 'WARN',
    blocking: false,
  },

  REDUCAO_INFERRED: {
    title: 'Reducao de base calculada (nao oficial)',
    happened: 'Sistema inferiu ~{mean}% (confianca: {confidence}).',
    impact: 'Valor nao vem do arquivo, pode estar errado.',
    action: 'Conferir legislacao estadual.',
    severity: 'INFO',
    blocking: false,
  },

  // ── Constraint errors (pre-validator) ──────────────────────────────────────

  CONSTRAINT_ERROR: {
    title: 'Erro de validacao na regra',
    happened: '{message}',
    impact: 'A regra nao pode ser criada no NetSuite enquanto esse erro nao for resolvido.',
    action: 'Corrija o campo indicado na regra ou determinacao.',
    severity: 'ERROR',
    blocking: true,
  },
};

// Labels legiveis para CSTs passivos
const PASSIVE_CST_LABELS = {
  '60': 'cobrado anteriormente por ST',
  '40': 'isento',
  '41': 'nao tributada',
  '50': 'suspensao',
};

/**
 * Traduz um reason code interno em mensagem legivel para leigo.
 *
 * @param {string} reason - Codigo interno (ex: 'RATE_CONFLICT', 'PARAMTYPE_MISSING')
 * @param {Object} [meta={}] - Dados contextuais para interpolacao
 * @returns {{ title: string, happened: string, impact: string, action: string, severity: string, blocking: boolean }}
 */
export function translateWarning(reason, meta = {}) {
  const template = WARNINGS[reason];
  if (!template) {
    return {
      title: reason,
      happened: '',
      impact: '',
      action: '',
      severity: 'INFO',
      blocking: false,
    };
  }

  // Enriquecer meta com labels derivados
  const enriched = { ...meta };
  if (meta.cst && !enriched.cstLabel) {
    enriched.cstLabel = PASSIVE_CST_LABELS[meta.cst] || meta.cst;
  }

  // Interpolacao: {key} → enriched[key]
  const interpolate = (str) =>
    str.replace(/\{(\w+)\}/g, (_, k) => enriched[k] != null ? enriched[k] : k);

  return {
    title: interpolate(template.title),
    happened: interpolate(template.happened),
    impact: interpolate(template.impact),
    action: interpolate(template.action),
    severity: template.severity,
    blocking: template.blocking,
  };
}

/**
 * Retorna o dicionario completo de warnings (para referencia/debug).
 */
export function getWarningCatalog() {
  return WARNINGS;
}
