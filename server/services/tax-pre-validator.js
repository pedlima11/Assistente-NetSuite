/**
 * Pre-Validador (Camada 4).
 *
 * Unica fonte de severity "error".
 *
 * Responsabilidades:
 * 1. Constraint checks (6 checks fechados)
 * 2. Auto-apply (3 cenarios deterministicos)
 * 3. Gerar autoApplies[] e constraintErrors[]
 *
 * Nunca altera campo nao-nulo (exceto cenario 2: formato CST).
 * Todo auto-apply e logado com scenario e source=preValidator.
 */

import { CST_TO_PARAM_TYPE, classifyCFOP } from '../../shared/tax-rule-core.js';
import { isPisCofinsCreditCst } from '../../src/data/fiscal-categories.js';

// ── Schema / Enums ──────────────────────────────────────────────────────────

const VALID_TAX_CODES = new Set([
  'ICMS_BR', 'ICMS_ST_BR', 'ICMS_DIFAL_BR', 'FCP_BR', 'FCP_ST_BR',
  'IPI_BR', 'PIS_BR', 'COFINS_BR', 'ISS_BR',
  'CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR',
]);

const VALID_OPERATION_TYPES = new Set([
  'Compra', 'Venda', 'Devolucao', 'Transferencia', 'Remessa/Retorno',
  'Aquisicao Servico', 'Prestacao Servico', 'Outros',
]);

const VALID_REGIMES = new Set([
  'Lucro Real', 'Lucro Presumido', 'Simples Nacional',
  'Contribuinte Individual', 'Estrangeiro',
  'Optante pelo Simples Nacional', // CRT 1/2/4
  '', 'unknown', 'N/A', // fallbacks aceitaveis
]);

// ── Pre-Validacao principal ─────────────────────────────────────────────────

/**
 * Executa pre-validacao sobre regras e determinacoes.
 *
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @param {Object} config - { nsParamTypes?, regimeEmissor?, regimeDestinatario? }
 * @returns {{ rules: Object[], determinations: Object[], autoApplies: Object[], constraintErrors: Object[] }}
 */
export function preValidate(rules, determinations, config) {
  const autoApplies = [];
  const constraintErrors = [];
  const ts = new Date().toISOString();

  // Indexar determinacoes por ruleExternalId
  const detsByRule = new Map();
  for (const det of determinations) {
    if (!detsByRule.has(det.ruleExternalId)) {
      detsByRule.set(det.ruleExternalId, []);
    }
    detsByRule.get(det.ruleExternalId).push(det);
  }

  for (const rule of rules) {
    // ── Check 1: CFOP invalido ──────────────────────────────────────────
    const cfopRaw = (rule.cfop || '').replace(/\./g, '');
    if (!/^\d{4}$/.test(cfopRaw)) {
      constraintErrors.push(makeError(
        rule.externalId, null, 'cfop', rule.cfop,
        `CFOP invalido: "${rule.cfop}". Esperado formato XXXX (4 digitos).`,
        ts
      ));
    }

    // Extrair direction para validacoes PIS/COFINS
    const { direction } = classifyCFOP(cfopRaw);

    const ruleDets = detsByRule.get(rule.externalId) || [];

    for (const det of ruleDets) {
      // ── Check 5: codigoImposto null ─────────────────────────────────
      if (!det.codigoImposto) {
        constraintErrors.push(makeError(
          rule.externalId, det.externalId, 'codigoImposto', null,
          'Codigo de imposto ausente.',
          ts
        ));
        continue; // Sem codigoImposto, outros checks nao fazem sentido
      }

      // ── Check 4: Enum invalido (codigoImposto) ─────────────────────
      if (!VALID_TAX_CODES.has(det.codigoImposto)) {
        constraintErrors.push(makeError(
          rule.externalId, det.externalId, 'codigoImposto', det.codigoImposto,
          `Codigo de imposto desconhecido: "${det.codigoImposto}".`,
          ts
        ));
      }

      // ── Check 2: Formato CST vs Regime ──────────────────────────────
      const regimeEmissor = rule.regimeEmissor || '';
      const isSN = regimeEmissor.includes('Simples Nacional');
      const cst = det._cst || '';

      if (cst && isSN && /^\d{2}$/.test(cst)) {
        // Simples Nacional deveria ter CSOSN (3 digitos), nao CST (2 digitos)
        // Auto-apply cenario 2: tentar corrigir
        const autoApplied = tryAutoApplyScenario2(det, rule, determinations, autoApplies, ts);
        if (!autoApplied) {
          constraintErrors.push(makeError(
            rule.externalId, det.externalId, '_cst', cst,
            `CST "${cst}" tem formato de Regime Normal (2 digitos), mas regime e Simples Nacional (esperado CSOSN 3 digitos).`,
            ts
          ));
        }
      } else if (cst && !isSN && regimeEmissor && regimeEmissor !== 'unknown' && regimeEmissor !== 'N/A' && /^\d{3}$/.test(cst)) {
        // Regime Normal nao deveria ter CSOSN (3 digitos)
        constraintErrors.push(makeError(
          rule.externalId, det.externalId, '_cst', cst,
          `CST "${cst}" tem formato de Simples Nacional (3 digitos), mas regime e "${regimeEmissor}".`,
          ts
        ));
      }

      // ── Check 3: Direcao PIS/COFINS ────────────────────────────────
      const taxType = det._taxType || '';
      if ((taxType === 'PIS' || taxType === 'COFINS') && cst && /^\d{2}$/.test(cst)) {
        const cstNum = parseInt(cst, 10);
        if (direction === 'entrada' && cstNum >= 1 && cstNum <= 49) {
          constraintErrors.push(makeError(
            rule.externalId, det.externalId, '_cst', cst,
            `${taxType} CST ${cst} e de saida (01-49), mas operacao e entrada (CFOP ${rule.cfop}).`,
            ts
          ));
        } else if (direction === 'saida' && cstNum >= 50 && cstNum <= 99) {
          constraintErrors.push(makeError(
            rule.externalId, det.externalId, '_cst', cst,
            `${taxType} CST ${cst} e de entrada (50-99), mas operacao e saida (CFOP ${rule.cfop}).`,
            ts
          ));
        }
      }

      // ── Check 6: tipoParametro null → warning ──────────────────────
      if (!det.tipoParametro) {
        // Auto-apply cenario 3: tentar preencher a partir do motor
        const autoApplied = tryAutoApplyScenario3(det, rule, direction, config, autoApplies, ts);
        if (!autoApplied) {
          // Nao e error — apenas warning registrado para IA
          constraintErrors.push({
            severity: 'warning',
            ruleExternalId: rule.externalId,
            determinationExternalId: det.externalId,
            field: 'tipoParametro',
            value: null,
            message: `tipoParametro nulo para ${det.codigoImposto} CST ${cst}. Requer preenchimento manual ou revisao IA.`,
            requiresApproval: true,
            ts,
          });
        }
      }

      // ── Auto-apply cenario 1: null + unico valor valido ────────────
      // (Apenas para campos que nao foram tratados acima)
      // Este cenario cobre codigoImposto null com unico candidato possivel
      // Na pratica, codigoImposto null ja e error no check 5.

      // ── Check 7: NAT_BC_CRED obrigatorio para credito PIS/COFINS ──
      if (
        (det.codigoImposto === 'PIS_BR' || det.codigoImposto === 'COFINS_BR') &&
        det._mergeSource === 'contrib' &&
        det._natMissing &&
        isPisCofinsCreditCst(det._cst)
      ) {
        constraintErrors.push(makeError(
          rule.externalId, det.externalId, 'natBcCred', null,
          `NAT_BC_CRED obrigatorio para ${det.codigoImposto} CST ${det._cst} (credito). Fonte: Contribuicoes. Preencha a categoria fiscal do item ou defina NAT manualmente.`,
          ts
        ));
      }
    }
  }

  return {
    rules,
    determinations,
    autoApplies,
    constraintErrors,
  };
}

// ── Auto-Apply Cenario 2: CST formato errado ───────────────────────────────

/**
 * Se CST tem 2 digitos mas regime e Simples Nacional,
 * tenta encontrar 1 CSOSN candidato com >=95% dominancia no dataset.
 *
 * @returns {boolean} true se auto-applied
 */
function tryAutoApplyScenario2(det, rule, allDeterminations, autoApplies, ts) {
  const taxType = det._taxType || '';
  const cst2 = det._cst;

  // Encontrar todas as determinacoes do mesmo tipo de imposto no dataset
  const sameTaxDets = allDeterminations.filter(d =>
    d._taxType === taxType && d._cst && /^\d{3}$/.test(d._cst)
  );

  if (sameTaxDets.length === 0) return false;

  // Contar CSOSNs
  const csonCounts = new Map();
  for (const d of sameTaxDets) {
    csonCounts.set(d._cst, (csonCounts.get(d._cst) || 0) + 1);
  }

  // Precisa ter exatamente 1 candidato dominante com >=95%
  if (csonCounts.size === 0) return false;

  const sorted = [...csonCounts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sameTaxDets.length;
  const [topCsosn, topCount] = sorted[0];
  const dominance = topCount / total;

  if (sorted.length !== 1 && dominance < 0.95) return false;

  // Aplicar
  const oldValue = det._cst;
  det._cst = topCsosn;

  autoApplies.push({
    eventType: 'AUTO_APPLY_PREVALIDATOR',
    source: 'preValidator',
    actor: 'system',
    scenario: 'preValidator_scenario2',
    ruleExternalId: rule.externalId,
    determinationExternalId: det.externalId,
    field: '_cst',
    oldValue,
    newValue: topCsosn,
    reason: `Formato CST corrigido: "${oldValue}" (2 dig) → "${topCsosn}" (CSOSN 3 dig). Dominancia: ${Math.round(dominance * 100)}% de ${total} registros.`,
    ts,
  });

  return true;
}

// ── Auto-Apply Cenario 3: tipoParametro null → CST_TO_PARAM_TYPE ───────────

/**
 * Se tipoParametro e null e CST_TO_PARAM_TYPE tem match univoco,
 * e nsParamTypes confirma o valor, preenche automaticamente.
 *
 * @returns {boolean} true se auto-applied
 */
function tryAutoApplyScenario3(det, rule, direction, config, autoApplies, ts) {
  const taxType = det._taxType || '';
  const cst = det._cst || '';

  if (!taxType || !cst) return false;

  // Lookup no motor deterministico
  const key = `${taxType}_${cst}_${direction}`;
  const suggested = CST_TO_PARAM_TYPE[key];

  if (!suggested) return false;

  // Se temos nsParamTypes do NetSuite, confirmar que o valor existe
  if (config.nsParamTypes && config.nsParamTypes.length > 0) {
    const found = config.nsParamTypes.some(pt => {
      const normPt = pt.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const normSugg = suggested.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      return normPt === normSugg || normPt.startsWith(normSugg.substring(0, 8));
    });
    if (!found) return false;
  }

  // Aplicar
  det.tipoParametro = suggested;

  autoApplies.push({
    eventType: 'AUTO_APPLY_PREVALIDATOR',
    source: 'preValidator',
    actor: 'system',
    scenario: 'preValidator_scenario3',
    ruleExternalId: rule.externalId,
    determinationExternalId: det.externalId,
    field: 'tipoParametro',
    oldValue: null,
    newValue: suggested,
    reason: `tipoParametro preenchido via CST_TO_PARAM_TYPE: ${taxType}_${cst}_${direction} → "${suggested}".`,
    ts,
  });

  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeError(ruleExtId, detExtId, field, value, message, ts) {
  return {
    severity: 'error',
    ruleExternalId: ruleExtId,
    determinationExternalId: detExtId,
    field,
    value,
    message,
    ts,
  };
}

// ── Priorizacao para truncamento (para envio ao AI Reviewer) ────────────────

/**
 * Prioriza e trunca regras/determinacoes para envio ao AI Reviewer.
 * P1: regras com error → SEMPRE incluidas
 * P2: regras com conflicts → ate limite
 * P3: regras com unresolvedFields → ate limite
 * P4: por itemCount desc → preencher ate maxRules/maxDets
 *
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @param {Object[]} constraintErrors
 * @param {Object} options - { maxRules: 200, maxDets: 500 }
 * @returns {{ rules: Object[], determinations: Object[] }}
 */
export function prioritizeForAI(rules, determinations, constraintErrors, options = {}) {
  const maxRules = options.maxRules || 200;
  const maxDets = options.maxDets || 500;

  // Indexar errors por ruleExternalId
  const errorRuleIds = new Set();
  for (const err of constraintErrors) {
    if (err.severity === 'error') {
      errorRuleIds.add(err.ruleExternalId);
    }
  }

  // Classificar regras
  const p1 = []; // error
  const p2 = []; // conflicts
  const p3 = []; // unresolvedFields (tipoParametro null)
  const p4 = []; // restante

  const detsByRule = new Map();
  for (const det of determinations) {
    if (!detsByRule.has(det.ruleExternalId)) {
      detsByRule.set(det.ruleExternalId, []);
    }
    detsByRule.get(det.ruleExternalId).push(det);
  }

  for (const rule of rules) {
    if (errorRuleIds.has(rule.externalId)) {
      p1.push(rule);
    } else if (rule.conflicts && rule.conflicts.length > 0) {
      p2.push(rule);
    } else {
      const dets = detsByRule.get(rule.externalId) || [];
      const hasUnresolved = dets.some(d => !d.tipoParametro);
      if (hasUnresolved) {
        p3.push(rule);
      } else {
        p4.push(rule);
      }
    }
  }

  // P4 sorted por itemCount desc
  p4.sort((a, b) => (b._nfeCount || 0) - (a._nfeCount || 0));

  // Montar resultado respeitando limites
  const selected = [];
  let detCount = 0;

  for (const bucket of [p1, p2, p3, p4]) {
    for (const rule of bucket) {
      if (selected.length >= maxRules) break;
      const dets = detsByRule.get(rule.externalId) || [];
      if (detCount + dets.length > maxDets && selected.length > 0) break;
      selected.push(rule);
      detCount += dets.length;
    }
  }

  const selectedIds = new Set(selected.map(r => r.externalId));
  const selectedDets = determinations.filter(d => selectedIds.has(d.ruleExternalId));

  return { rules: selected, determinations: selectedDets };
}
