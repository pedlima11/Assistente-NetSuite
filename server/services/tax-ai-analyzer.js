/**
 * AI Analyzer (Camada 5).
 *
 * Responsabilidades:
 * 1. Context pack (anonimizar PII + compactar)
 * 2. Cache check (SHA-256)
 * 3. Claude call (temp=0)
 * 4. Delegar validacao ao tax-ai-validator
 * 5. Retornar issues + patches + auditSummary
 *
 * Server-only: usa crypto de Node.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { canonicalize, deterministicHash } from '../../shared/canonical.js';
import { validateAIOutput } from './tax-ai-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '..', 'data', 'tax-ai-cache');
const AUDIT_DIR = resolve(__dirname, '..', 'data', 'tax-audit-logs');
const PROMPT_VERSION = 'v1.0';
const MODEL_ID = 'claude-sonnet-4-20250514';
const MIN_ITEMS_FOR_AI = 50;
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

// Garantir diretorios existem
for (const dir of [CACHE_DIR, AUDIT_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── PII Anonymization ───────────────────────────────────────────────────────

function anonymizeCnpj(cnpj) {
  if (!cnpj) return null;
  return 'sup-' + deterministicHash(cnpj).substring(0, 8);
}

function anonymizeDocKey(key) {
  if (!key) return null;
  return 'doc-' + deterministicHash(key).substring(0, 8);
}

function anonymizeRule(rule) {
  const anon = { ...rule };
  if (anon.evidence) {
    anon.evidence = { ...anon.evidence };
    if (anon.evidence.sampleDocs) {
      anon.evidence.sampleDocs = anon.evidence.sampleDocs.map(anonymizeDocKey);
    }
  }
  // Incluir dados estatisticos para melhor analise da IA
  if (rule.signatureSummary) anon.signatureSummary = rule.signatureSummary;
  if (rule.ruleStats) anon.ruleStats = rule.ruleStats;
  if (rule.confidenceScore != null) anon.confidenceScore = rule.confidenceScore;
  if (rule.hasConflict) anon.hasConflict = rule.hasConflict;
  if (rule._ruleGroupKey) anon._ruleGroupKey = rule._ruleGroupKey;
  if (rule._reducaoBCStats) anon._reducaoBCStats = rule._reducaoBCStats;
  return anon;
}

// ── Context Pack ────────────────────────────────────────────────────────────

function buildContextPack(rules, determinations, stats, constraintErrors) {
  const schema = {
    enums: {
      codigoImposto: ['ICMS_BR', 'ICMS_ST_BR', 'IPI_BR', 'PIS_BR', 'COFINS_BR', 'ISS_BR', 'CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR'],
      operationType: ['Compra', 'Venda', 'Devolucao', 'Transferencia', 'Remessa/Retorno', 'Aquisicao Servico', 'Prestacao Servico', 'Outros'],
      regime: ['Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'Contribuinte Individual', 'Estrangeiro'],
    },
    dependencies: [
      { if: { regime: 'Simples Nacional' }, then: { cstPattern: '^\\d{3}$' } },
      { if: { direction: 'entrada', taxType: 'PIS|COFINS' }, then: { cstRange: '50-99' } },
      { if: { direction: 'saida', taxType: 'PIS|COFINS' }, then: { cstRange: '01-49' } },
    ],
  };

  return {
    schema,
    rules: rules.map(anonymizeRule),
    determinations,
    stats,
    constraintErrors: constraintErrors.filter(e => e.severity === 'error'),
  };
}

// ── Cache ────────────────────────────────────────────────────────────────────

function computeCacheKey(contextPack) {
  const canonical = canonicalize(contextPack, null);
  return createHash('sha256')
    .update(JSON.stringify({ v: PROMPT_VERSION, d: canonical }))
    .digest('hex');
}

function getCachedResult(cacheKey) {
  const filePath = resolve(CACHE_DIR, `${cacheKey}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (Date.now() - data._cachedAt > CACHE_TTL_MS) {
      unlinkSync(filePath);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedResult(cacheKey, result) {
  const filePath = resolve(CACHE_DIR, `${cacheKey}.json`);
  writeFileSync(filePath, JSON.stringify({ ...result, _cachedAt: Date.now() }, null, 2), 'utf-8');
}

// ── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt() {
  return `Voce e um revisor de consistencia de dados estruturados de regras fiscais brasileiras.

Receba: SCHEMA (enums validos e dependencias), DADOS (regras pos-auto-apply + determinacoes + stats + erros de constraint).

Cada regra pode conter:
- signatureSummary: distribuicao de assinaturas fiscais (impostos+CST+aliquota). isMain=true indica a dominante.
- ruleStats: { items, documents, uniqueNCM, uniqueSuppliers }
- confidenceScore: % da assinatura principal (alto = consistente, baixo = muitas variantes)
- hasConflict: true se mais de 1 assinatura significativa
- _reducaoBCStats: { mean, stddev, confidence } para CST 20/51 com reducao BC inferida

Tarefas:
- Detectar outliers estatisticos: valores atipicos de aliquota vs distribuicao do dataset
- Usar signatureSummary para identificar regras com conflitos internos significativos
- Usar confidenceScore para priorizar regras que precisam de atencao (score baixo)
- Identificar gaps de cobertura: pares CFOP/UF esperados mas ausentes
- Propor correcoes com evidencia, usando EXCLUSIVAMENTE valores do schema.enums
- Para cada proposta: evidencia numerica, risco ("medium" ou "high"), "por que X e nao Y"

NAO deve:
- Emitir severity "error" (reservado ao validador deterministico)
- Inventar valores fora dos enums fornecidos
- Usar conhecimento externo sobre aliquotas — apenas consistencia interna do dataset
- Propor sem evidencia numerica

Limites estritos:
- maxIssues: 150
- maxProposedChanges: 80
- max 3 changes por regra

Severidade: APENAS "warning" ou "info".

Saida: JSON puro (sem markdown, sem comentarios) com formato:
{
  "issues": [
    {
      "id": "ISS-001",
      "severity": "warning",
      "ruleExternalId": "...",
      "field": "aliquota",
      "message": "...",
      "sourceType": "heuristic",
      "evidence": { "distribution": {}, "itemCount": 150 }
    }
  ],
  "proposedChanges": [
    {
      "id": "CHG-001",
      "issueId": "ISS-001",
      "ruleExternalId": "...",
      "determinationExternalId": "...",
      "field": "tipoParametro",
      "currentValue": "...",
      "selectedValue": "...",
      "_aiSuggestedValues": ["..."],
      "risk": "medium",
      "evidence": { "reason": "...", "statisticalBasis": "..." }
    }
  ],
  "explanations": {}
}`;
}

// ── Claude Call ──────────────────────────────────────────────────────────────

async function callClaude(apiKey, contextPack) {
  const prompt = buildPrompt();
  const body = {
    model: MODEL_ID,
    temperature: 0,
    max_tokens: 4096,
    messages: [
      { role: 'user', content: prompt + '\n\n' + JSON.stringify(contextPack) },
    ],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.content[0].text;

  // Parse JSON do response
  try {
    return JSON.parse(text);
  } catch {
    // Tentar extrair JSON de possivel markdown wrapper
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('AI response is not valid JSON');
  }
}

// ── Audit Logging ───────────────────────────────────────────────────────────

function persistAuditLog(contextHash, events) {
  const filePath = resolve(AUDIT_DIR, `${contextHash}.json`);
  writeFileSync(filePath, JSON.stringify(events, null, 2), 'utf-8');
}

function buildAuditSummary(events) {
  const counts = {};
  for (const e of events) {
    counts[e.eventType] = (counts[e.eventType] || 0) + 1;
  }
  return {
    totalEvents: events.length,
    counts,
    recentEvents: events.slice(-20),
  };
}

// ── Limpeza de cache expirado ───────────────────────────────────────────────

function cleanExpiredCache() {
  try {
    const files = readdirSync(CACHE_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = resolve(CACHE_DIR, file);
      const stat = statSync(filePath);
      if (now - stat.mtimeMs > CACHE_TTL_MS) {
        unlinkSync(filePath);
      }
    }
  } catch {
    // Ignora erros de limpeza
  }
}

// ── Entrypoint principal ────────────────────────────────────────────────────

/**
 * Analisa regras fiscais usando IA como revisor de consistencia.
 *
 * @param {Object} params
 * @param {Object[]} params.rules - Regras pos-motor
 * @param {Object[]} params.determinations - Determinacoes pos-motor
 * @param {Object} params.stats - Stats do stats-builder
 * @param {Object[]} params.autoApplies - Auto-applies do pre-validador
 * @param {Object[]} params.constraintErrors - Errors do pre-validador
 * @param {Object} params.config - { nsParamTypes?, totalItems? }
 * @param {string} params.apiKey - Claude API key
 * @returns {Promise<Object>}
 */
export async function analyzeTaxRules({
  rules, determinations, stats, autoApplies, constraintErrors, config, apiKey,
}) {
  const auditEvents = [...autoApplies];
  const ts = new Date().toISOString();

  // Se dataset muito pequeno, skip IA
  const totalItems = config.totalItems || stats.totalRules || 0;
  if (totalItems < MIN_ITEMS_FOR_AI || !apiKey) {
    const contextHash = computeCacheKey({ rules: [], determinations: [], stats });
    persistAuditLog(contextHash, auditEvents);

    return {
      rules,
      determinations,
      autoApplies,
      constraintErrors,
      aiIssues: [],
      aiPatches: [],
      auditSummary: buildAuditSummary(auditEvents),
      contextHash,
      skippedAI: !apiKey ? 'no_api_key' : 'below_threshold',
    };
  }

  // Build context pack
  const contextPack = buildContextPack(rules, determinations, stats, constraintErrors);
  const contextHash = computeCacheKey(contextPack);

  // Check cache
  const cached = getCachedResult(contextHash);
  if (cached) {
    persistAuditLog(contextHash, auditEvents);
    return {
      rules,
      determinations,
      autoApplies,
      constraintErrors,
      aiIssues: cached.issues || [],
      aiPatches: cached.proposedChanges || [],
      auditSummary: buildAuditSummary(auditEvents),
      contextHash,
      fromCache: true,
    };
  }

  // Call Claude
  let rawAIOutput;
  try {
    rawAIOutput = await callClaude(apiKey, contextPack);
  } catch (err) {
    // Graceful degradation: IA falhou mas pre-validador OK
    auditEvents.push({
      eventType: 'AI_CALL_FAILED',
      source: 'aiReviewer',
      actor: 'system',
      reason: err.message,
      ts,
    });
    persistAuditLog(contextHash, auditEvents);

    return {
      rules,
      determinations,
      autoApplies,
      constraintErrors,
      aiIssues: [],
      aiPatches: [],
      auditSummary: buildAuditSummary(auditEvents),
      contextHash,
      aiError: err.message,
    };
  }

  // Validar output da IA
  const validated = validateAIOutput(rawAIOutput, rules, determinations, contextHash, auditEvents);

  // Cache resultado validado
  setCachedResult(contextHash, {
    issues: validated.issues,
    proposedChanges: validated.proposedChanges,
    promptVersion: PROMPT_VERSION,
    modelId: MODEL_ID,
  });

  // Persist audit log completo
  persistAuditLog(contextHash, auditEvents);

  // Cleanup periodico (async, nao bloqueia)
  cleanExpiredCache();

  return {
    rules,
    determinations,
    autoApplies,
    constraintErrors,
    aiIssues: validated.issues,
    aiPatches: validated.proposedChanges,
    auditSummary: buildAuditSummary(auditEvents),
    contextHash,
  };
}

/**
 * Retorna o log de auditoria completo para um contextHash.
 *
 * @param {string} contextHash
 * @returns {Object[]|null}
 */
export function getAuditLog(contextHash) {
  const filePath = resolve(AUDIT_DIR, `${contextHash}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
