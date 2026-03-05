/**
 * Stats Builder (Camada 3).
 *
 * Calcula estatisticas do dataset de regras/determinacoes
 * para alimentar o AI Reviewer e o pre-validador.
 *
 * CONTRATO: todo array emitido TEM campo "key" para canonicalize().
 */

/**
 * Constroi estatisticas agregadas a partir de rules e determinations.
 *
 * @param {Object[]} rules
 * @param {Object[]} determinations
 * @returns {Object} stats object
 */
export function buildStats(rules, determinations) {
  // ── Distribuicao por codigoImposto ──────────────────────────────────────
  const taxCodeDist = new Map();
  for (const det of determinations) {
    const code = det.codigoImposto || 'unknown';
    if (!taxCodeDist.has(code)) {
      taxCodeDist.set(code, { key: code, count: 0, aliqSum: 0, aliqMin: Infinity, aliqMax: -Infinity, csts: new Map() });
    }
    const entry = taxCodeDist.get(code);
    entry.count++;
    const aliq = parseFloat(det.aliquota) || 0;
    entry.aliqSum += aliq;
    if (aliq < entry.aliqMin) entry.aliqMin = aliq;
    if (aliq > entry.aliqMax) entry.aliqMax = aliq;
    const cst = det._cst || 'unknown';
    entry.csts.set(cst, (entry.csts.get(cst) || 0) + 1);
  }

  const taxCodeStats = [...taxCodeDist.values()].map(e => ({
    key: e.key,
    count: e.count,
    aliqAvg: e.count > 0 ? parseFloat((e.aliqSum / e.count).toFixed(4)) : 0,
    aliqMin: e.aliqMin === Infinity ? 0 : e.aliqMin,
    aliqMax: e.aliqMax === -Infinity ? 0 : e.aliqMax,
    cstDistribution: [...e.csts.entries()].map(([cst, count]) => ({ key: cst, count })),
  }));

  // ── Distribuicao por operationType ──────────────────────────────────────
  const opTypeDist = new Map();
  for (const rule of rules) {
    const name = rule.name || '';
    // operationType esta no nome — extrair do padrao "Compra de ..."
    const opMatch = name.match(/^(\S+(?:\s+\S+)?)\s+de\s+/);
    const opType = opMatch ? opMatch[1] : 'Outros';
    if (!opTypeDist.has(opType)) {
      opTypeDist.set(opType, { key: opType, count: 0, itemCount: 0 });
    }
    const entry = opTypeDist.get(opType);
    entry.count++;
    entry.itemCount += rule._nfeCount || 0;
  }

  const operationTypeStats = [...opTypeDist.values()];

  // ── Distribuicao por CFOP ───────────────────────────────────────────────
  const cfopDist = new Map();
  for (const rule of rules) {
    const cfop = rule.cfop || 'unknown';
    if (!cfopDist.has(cfop)) {
      cfopDist.set(cfop, { key: cfop, count: 0, itemCount: 0 });
    }
    const entry = cfopDist.get(cfop);
    entry.count++;
    entry.itemCount += rule._nfeCount || 0;
  }

  const cfopStats = [...cfopDist.values()];

  // ── Distribuicao por UF ─────────────────────────────────────────────────
  const ufPairDist = new Map();
  for (const rule of rules) {
    const pair = `${rule.ufEmissor || '??'}->${rule.ufDestinatario || '??'}`;
    if (!ufPairDist.has(pair)) {
      ufPairDist.set(pair, { key: pair, count: 0, itemCount: 0 });
    }
    const entry = ufPairDist.get(pair);
    entry.count++;
    entry.itemCount += rule._nfeCount || 0;
  }

  const ufPairStats = [...ufPairDist.values()];

  // ── Distribuicao por regime ─────────────────────────────────────────────
  const regimeDist = new Map();
  for (const rule of rules) {
    const regime = rule.regimeEmissor || 'unknown';
    if (!regimeDist.has(regime)) {
      regimeDist.set(regime, { key: regime, count: 0 });
    }
    regimeDist.get(regime).count++;
  }

  const regimeStats = [...regimeDist.values()];

  // ── Distribuicao de tipoParametro ───────────────────────────────────────
  const paramDist = new Map();
  let nullParamCount = 0;
  for (const det of determinations) {
    const param = det.tipoParametro || '';
    if (!param) {
      nullParamCount++;
      continue;
    }
    if (!paramDist.has(param)) {
      paramDist.set(param, { key: param, count: 0 });
    }
    paramDist.get(param).count++;
  }

  const paramTypeStats = [...paramDist.values()];

  // ── Distribuicao de aliquotas por tipo de imposto ───────────────────────
  const aliqByTax = new Map();
  for (const det of determinations) {
    const taxType = det._taxType || det.codigoImposto || 'unknown';
    const aliq = parseFloat(det.aliquota) || 0;
    const bucket = `${taxType}:${aliq}`;
    if (!aliqByTax.has(bucket)) {
      aliqByTax.set(bucket, { key: bucket, taxType, aliquota: aliq, count: 0 });
    }
    aliqByTax.get(bucket).count++;
  }

  const aliquotaStats = [...aliqByTax.values()];

  // ── Distribuicao de NAT_BC_CRED (PIS/COFINS contrib) ──────────────────
  const natDist = new Map();
  let natMissingCount = 0;
  for (const det of determinations) {
    if (det.codigoImposto !== 'PIS_BR' && det.codigoImposto !== 'COFINS_BR') continue;
    if (det._natMissing) {
      natMissingCount++;
      continue;
    }
    const nat = det.natBcCred || '';
    if (!nat) continue;
    if (!natDist.has(nat)) {
      natDist.set(nat, { key: nat, count: 0 });
    }
    natDist.get(nat).count++;
  }

  const natBcCredStats = [...natDist.values()];

  // ── Distribuicao de mergeSource ───────────────────────────────────────
  const mergeSourceDist = new Map();
  for (const det of determinations) {
    const src = det._mergeSource || 'unknown';
    if (!mergeSourceDist.has(src)) {
      mergeSourceDist.set(src, { key: src, count: 0 });
    }
    mergeSourceDist.get(src).count++;
  }

  const mergeSourceStats = [...mergeSourceDist.values()];

  // ── Regras com conflitos ────────────────────────────────────────────────
  const rulesWithConflicts = rules.filter(r => r.conflicts && r.conflicts.length > 0).length;

  // ── Excecoes vs genericas ───────────────────────────────────────────────
  const genericCount = rules.filter(r => !r._isException).length;
  const exceptionCount = rules.filter(r => r._isException).length;

  // ── GeoStats para Fiscal Review Studio ──────────────────────────────────
  const routeMetrics = {};
  const detsByRule = new Map();
  for (const det of determinations) {
    if (!detsByRule.has(det.ruleExternalId)) detsByRule.set(det.ruleExternalId, []);
    detsByRule.get(det.ruleExternalId).push(det);
  }

  for (const rule of rules) {
    const routeKey = rule._routeKey || `${rule.ufEmissor || '??'}->${rule.ufDestinatario || '??'}`;
    if (!routeMetrics[routeKey]) {
      routeMetrics[routeKey] = { totalValue: 0, totalOps: 0, totalRules: 0, cleanRules: 0, problemRules: 0 };
    }
    const rm = routeMetrics[routeKey];
    rm.totalValue += rule._totalValue || 0;
    rm.totalOps += rule._nfeCount || 0;
    rm.totalRules++;

    const hasConflict = rule.conflicts && rule.conflicts.length > 0;
    const ruleDets = detsByRule.get(rule.externalId) || [];
    const hasUnresolved = ruleDets.some(d => d._unresolvedParam);
    if (hasConflict || hasUnresolved) {
      rm.problemRules++;
    } else {
      rm.cleanRules++;
    }
  }

  // Derivar status por rota
  for (const key of Object.keys(routeMetrics)) {
    const rm = routeMetrics[key];
    if (rm.problemRules === 0) {
      rm.status = 'clean';
    } else if (rm.problemRules < rm.totalRules) {
      rm.status = 'partial';
    } else {
      rm.status = 'pending';
    }
  }

  // Coverage global por valor
  let cleanValue = 0;
  let totalValueAll = 0;
  for (const rule of rules) {
    const val = rule._totalValue || 0;
    totalValueAll += val;
    const hasConflict = rule.conflicts && rule.conflicts.length > 0;
    const ruleDets = detsByRule.get(rule.externalId) || [];
    const hasUnresolved = ruleDets.some(d => d._unresolvedParam);
    if (!hasConflict && !hasUnresolved) cleanValue += val;
  }

  const geoStats = {
    routeMetrics,
    coverageByValue: totalValueAll > 0 ? parseFloat((cleanValue / totalValueAll).toFixed(4)) : null,
    totalValue: totalValueAll,
  };

  return {
    totalRules: rules.length,
    totalDeterminations: determinations.length,
    genericRules: genericCount,
    exceptionRules: exceptionCount,
    rulesWithConflicts,
    nullParamCount,
    taxCodeStats,
    operationTypeStats,
    cfopStats,
    ufPairStats,
    regimeStats,
    paramTypeStats,
    aliquotaStats,
    natBcCredStats,
    natMissingCount,
    mergeSourceStats,
    geoStats,
  };
}
