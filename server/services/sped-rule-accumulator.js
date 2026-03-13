/**
 * Acumulador de items fiscais on-the-fly para SPED.
 *
 * Recebe itens normalizados um a um (do sped-tax-normalizer)
 * e os acumula com validacao pre-acumulacao.
 *
 * NAO gera regras nem determinacoes — essas sao criadas pelo usuario na UI.
 * Itens com dados invalidos vao para needsReview[].
 */

import {
  makeRuleKey,
  normalizeCFOP,
  classifyCFOP,
} from '../../shared/tax-rule-core.js';

import { IBGE_TO_UF } from '../parsers/sped-common.js';

// UFs validas para validacao pre-acumulacao
const VALID_UFS = new Set(Object.values(IBGE_TO_UF));

/**
 * @param {Object} config
 * @param {string} config.subsidiaryName
 * @param {string} config.regimeDestinatario
 * @param {string} config.lobDestinatario
 * @param {string} [config.validoAPartirDe]
 * @param {string} [config.subsidiaryCnpj]
 * @param {Object[]} [config.nsParamTypes]
 * @param {boolean} [config.contribMode=false]
 */
export class RuleAccumulator {
  constructor(config) {
    this.config = { ...config, source: config.contribMode ? 'contrib' : 'sped' };
    this._contribMode = !!config.contribMode;
    this.needsReview = [];
    this._items = [];
    this._nextItemSeq = 0;
    this._groupKeys = new Set();
    this.qualityStats = {
      itemsRead: 0,
      itemsAccepted: 0,
      itemsWarning: 0,
      itemsRejected: 0,
      rejectionReasons: {},
      warningReasons: {},
      noIcmsCstByCfop: {},
      uniqueCFOPs: new Set(),
      uniqueNCMs: new Set(),
      uniqueUFs: new Set(),
    };
  }

  // Tax types ignorados no contribMode
  static _CONTRIB_SKIP_TYPES = new Set(['ICMS', 'ICMS_ST', 'IPI', 'CBS', 'IBS', 'IS']);

  /**
   * Preserva copia leve do item.
   */
  _pushItem(item, rejectionReason) {
    this._items.push({
      _itemId: `item-${this._nextItemSeq++}`,
      assignedRuleId: null,
      nfeKey: item.nfeKey,
      nNF: item.nNF,
      dtDoc: item.dtDoc || item.dhEmi,
      serie: item.serie || '',
      emitCNPJ: item.emitCNPJ,
      emitUF: item.emitUF,
      emitName: item.emitName || '',
      destUF: item.destUF,
      cfop: item.cfopNormalized || item.cfop,
      ncm: item.ncm,
      vlItem: item.vlItem,
      codItem: item.codItem,
      numItem: item.numItem || '',
      _sourceDetail: item._sourceDetail || '',
      descrCompl: item.descrCompl,
      taxes: (item.taxes || []).map(t => ({
        type: t.type, cst: t.cst, aliq: t.aliq, bc: t.bc, valor: t.valor,
        cClassTrib: t.cClassTrib || '',
        ...(t.natBcCred !== undefined && { natBcCred: t.natBcCred }),
        ...(t.natMissing !== undefined && { natMissing: t.natMissing }),
        ...(t.natSource !== undefined && { natSource: t.natSource }),
      })),
      source: this.config.source || 'sped',
      _rejected: !!rejectionReason,
      _rejectionReason: rejectionReason || null,
    });
  }

  /**
   * Valida item antes de acumular. Itens invalidos vao para needsReview.
   * @returns {boolean} true se item e valido e deve ser acumulado
   */
  _validateItem(item) {
    const cfopNorm = normalizeCFOP(item.cfop);
    item.cfopOriginal = item.cfop;
    item.cfopNormalized = cfopNorm;

    const destUF = (item.destUF || '').toUpperCase().trim();
    if (!destUF || !VALID_UFS.has(destUF)) {
      this.needsReview.push({ item, reason: 'DEST_UF_MISSING', vlItem: item.vlItem || 0 });
      this._pushItem(item, 'DEST_UF_MISSING');
      return false;
    }

    const emitUF = (item.emitUF || '').toUpperCase().trim();
    if (!emitUF || !VALID_UFS.has(emitUF)) {
      this.needsReview.push({ item, reason: 'EMIT_UF_MISSING', vlItem: item.vlItem || 0 });
      this._pushItem(item, 'EMIT_UF_MISSING');
      return false;
    }

    if (!/^\d{4}$/.test(cfopNorm)) {
      this.needsReview.push({ item, reason: 'CFOP_INVALID', vlItem: item.vlItem || 0 });
      this._pushItem(item, 'CFOP_INVALID');
      return false;
    }

    const classified = classifyCFOP(cfopNorm);
    if (classified.direction === 'desconhecido') {
      this.needsReview.push({ item, reason: 'OP_UNKNOWN', vlItem: item.vlItem || 0 });
      this._pushItem(item, 'OP_UNKNOWN');
      return false;
    }

    return true;
  }

  /**
   * Registra um item normalizado.
   */
  addItem(item) {
    this.qualityStats.itemsRead++;

    if (!this._validateItem(item)) {
      return;
    }

    this.qualityStats.itemsAccepted++;

    if (item.cfopNormalized) this.qualityStats.uniqueCFOPs.add(item.cfopNormalized);
    if (item.ncm) this.qualityStats.uniqueNCMs.add(item.ncm);
    if (item.emitUF) this.qualityStats.uniqueUFs.add(item.emitUF);
    if (item.destUF) this.qualityStats.uniqueUFs.add(item.destUF);

    // contribMode: filtrar taxes
    const taxes = this._contribMode
      ? item.taxes.filter(t => !RuleAccumulator._CONTRIB_SKIP_TYPES.has(t.type))
      : item.taxes;

    if (taxes.length === 0) return;

    // Track group keys for stats
    const key = makeRuleKey(item, this.config);
    this._groupKeys.add(key);

    // Preservar item
    this._pushItem(item, null);
  }

  /**
   * Registra item com warning (aceito mas incompleto).
   */
  addWarningItem(item, warningReasons) {
    this.qualityStats.itemsWarning++;
    for (const reason of warningReasons) {
      this.qualityStats.warningReasons[reason] = (this.qualityStats.warningReasons[reason] || 0) + 1;
    }
    // Breakdown de CST_ICMS ausente por CFOP
    if (warningReasons.includes('noIcmsCst') && item.cfop) {
      this.qualityStats.noIcmsCstByCfop[item.cfop] =
        (this.qualityStats.noIcmsCstByCfop[item.cfop] || 0) + 1;
    }
    this.addItem(item);
  }

  /**
   * Registra rejeicao sem acumular item.
   */
  trackRejection(reason) {
    this.qualityStats.itemsRead++;
    this.qualityStats.itemsRejected++;
    this.qualityStats.rejectionReasons[reason] = (this.qualityStats.rejectionReasons[reason] || 0) + 1;
  }

  /**
   * Finaliza processamento: retorna items + stats.
   *
   * @returns {{ items: Object[], needsReview: Object[], needsReviewByReason: Object, stats: Object, qualityStats: Object, warnings: string[] }}
   */
  finalize() {
    // needsReviewByReason
    const needsReviewByReason = {};
    for (const nr of this.needsReview) {
      if (!needsReviewByReason[nr.reason]) {
        needsReviewByReason[nr.reason] = { count: 0, totalValue: 0 };
      }
      needsReviewByReason[nr.reason].count++;
      needsReviewByReason[nr.reason].totalValue += nr.vlItem || 0;
    }
    for (const entry of Object.values(needsReviewByReason)) {
      entry.totalValue = parseFloat(entry.totalValue.toFixed(4));
    }

    // Warnings
    const warnings = [];
    const totalProcessed = this.qualityStats.itemsRead;
    const destMissingCount = needsReviewByReason.DEST_UF_MISSING?.count || 0;
    if (totalProcessed > 0 && destMissingCount > totalProcessed * 0.5) {
      warnings.push(`COMPANY_INFO_CORRUPTED: ${destMissingCount} de ${totalProcessed} itens (${Math.round(destMissingCount / totalProcessed * 100)}%) com DEST_UF_MISSING.`);
    }

    // Convert Sets to numbers
    const qs = {
      ...this.qualityStats,
      uniqueCFOPs: this.qualityStats.uniqueCFOPs.size,
      uniqueNCMs: this.qualityStats.uniqueNCMs.size,
      uniqueUFs: this.qualityStats.uniqueUFs.size,
    };

    return {
      items: this._items,
      needsReview: this.needsReview,
      needsReviewByReason,
      stats: {
        totalItems: qs.itemsRead,
        totalGroups: this._groupKeys.size,
        needsReviewCount: this.needsReview.length,
      },
      qualityStats: qs,
      warnings,
    };
  }
}
