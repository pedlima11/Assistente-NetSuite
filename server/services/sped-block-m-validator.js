/**
 * Validador Bloco M — SPED EFD Contribuicoes.
 *
 * Compara valores item-level acumulados vs apuracao oficial (M100/M105/M500/M505).
 * Severity sempre 'warning' (M pode ter ajustes nao refletidos nos itens).
 *
 * Thresholds adaptativos:
 *   base < R$ 10.000: warning apenas se absDiff > R$ 500
 *   base >= R$ 10.000: warning se absDiff > R$ 1.000 AND diffPercent > 5%
 */

import { NAT_BC_CRED } from '../../shared/tax-rule-core.js';

/**
 * Valida regras/determinacoes contra Bloco M.
 *
 * @param {Object[]} determinations - Determinacoes finais (com natBcCred)
 * @param {Object} blockM - { m100, m105, m500, m505 } do parser
 * @param {Object} [options]
 * @returns {{ matches: Object[], summary: Object }}
 */
export function validateBlockM(determinations, blockM, options = {}) {
  const matches = [];

  // ── PIS: item-level vs M105 por NAT ─────────────────────────────────────

  const pisDetsByNat = groupByNat(determinations, 'PIS_BR');

  for (const m105 of (blockM.m105 || [])) {
    const nat = m105.natBcCred;
    if (!nat) continue;

    const itemDets = pisDetsByNat.get(nat) || [];
    const calculatedBase = itemDets.reduce((s, d) => s + (d.aliquota > 0 ? (d._bcAccum || 0) : 0), 0);
    // Fallback: usar count como proxy se _bcAccum nao disponivel
    const officialBase = m105.vlBcPisTot || 0;

    const match = buildMatch(nat, 'PIS', officialBase, calculatedBase);
    matches.push(match);
  }

  // ── COFINS: item-level vs M505 por NAT ──────────────────────────────────

  const cofinsDetsByNat = groupByNat(determinations, 'COFINS_BR');

  for (const m505 of (blockM.m505 || [])) {
    const nat = m505.natBcCred;
    if (!nat) continue;

    const itemDets = cofinsDetsByNat.get(nat) || [];
    const calculatedBase = itemDets.reduce((s, d) => s + (d.aliquota > 0 ? (d._bcAccum || 0) : 0), 0);
    const officialBase = m505.vlBcCofinsTot || 0;

    const match = buildMatch(nat, 'COFINS', officialBase, calculatedBase);
    matches.push(match);
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  const totalDetsWithNat = determinations.filter(d =>
    (d.codigoImposto === 'PIS_BR' || d.codigoImposto === 'COFINS_BR') && d.natBcCred
  ).length;
  const totalPisCofins = determinations.filter(d =>
    d.codigoImposto === 'PIS_BR' || d.codigoImposto === 'COFINS_BR'
  ).length;

  const sourcesUsed = {
    item_level: 0,
    consolidated: 0,
    fiscal_fallback: 0,
  };
  for (const d of determinations) {
    if (d._mergeSource === 'contrib') sourcesUsed.item_level++;
    else if (d._mergeSource === 'consolidated') sourcesUsed.consolidated++;
    else if (d._mergeSource === 'fiscal_fallback') sourcesUsed.fiscal_fallback++;
  }

  return {
    matches,
    summary: {
      coverage: totalPisCofins > 0 ? parseFloat((totalDetsWithNat / totalPisCofins).toFixed(2)) : 0,
      sourcesUsed,
      totalMatches: matches.length,
      warningCount: matches.filter(m => m.severity === 'warning').length,
      okCount: matches.filter(m => m.severity === 'ok').length,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupByNat(determinations, codigoImposto) {
  const map = new Map();
  for (const d of determinations) {
    if (d.codigoImposto !== codigoImposto || !d.natBcCred) continue;
    if (!map.has(d.natBcCred)) map.set(d.natBcCred, []);
    map.get(d.natBcCred).push(d);
  }
  return map;
}

function buildMatch(nat, taxType, officialBase, calculatedBase) {
  const absDiff = Math.abs(officialBase - calculatedBase);
  const diffPercent = officialBase > 0
    ? parseFloat(((absDiff / officialBase) * 100).toFixed(1))
    : (calculatedBase > 0 ? 100 : 0);

  let severity = 'ok';

  if (officialBase < 10000) {
    // Base pequena: warning apenas se absDiff > R$ 500
    if (absDiff > 500) severity = 'warning';
  } else {
    // Base grande: warning se absDiff > R$ 1.000 AND diffPercent > 5%
    if (absDiff > 1000 && diffPercent > 5) severity = 'warning';
  }

  return {
    nat,
    natLabel: NAT_BC_CRED[nat] || '',
    taxType,
    officialBase,
    calculatedBase,
    absDiff: parseFloat(absDiff.toFixed(2)),
    diffPercent,
    severity,
  };
}
