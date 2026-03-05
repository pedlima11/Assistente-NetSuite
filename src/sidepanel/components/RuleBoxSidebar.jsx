import React, { useState, useMemo } from 'react';
import { Plus, ChevronDown, ChevronRight, Trash2, X, Info, Check } from 'lucide-react';
import { getRuleColor, UNASSIGNED_COLOR } from '../../utils/rule-colors.js';
import { computeNcmBreakdown } from '../../../shared/item-grouping.js';
import { TAX_CODES } from '../../data/tax-reference.js';

const fmtBRL = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Exception card — nested under parent rule */
function ExceptionCard({ exc, allRuleIds, countByRule, valueByRule, detsByRule, dropTargetRuleId,
  onDragOver, onDragLeave, onDrop, onUpdateRuleName, onUpdateDet, onRemoveDet, onAddDet, onRemoveException,
  parentRuleId, paramTypeOptions }) {
  const [expanded, setExpanded] = useState(false);
  const excColor = getRuleColor(exc.externalId, allRuleIds);
  const excCount = countByRule.get(exc.externalId) || 0;
  const excValue = valueByRule.get(exc.externalId) || 0;
  const excDets = detsByRule.get(exc.externalId) || [];

  return (
    <div
      data-rule-id={exc.externalId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`rounded-lg border overflow-hidden shadow-sm transition-all ${
        dropTargetRuleId === exc.externalId
          ? `ring-2 ${excColor.ring} border-transparent shadow-md`
          : 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
      }`}
    >
      {/* Amber top bar for exceptions */}
      <div className="h-1 bg-amber-400" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setExpanded(!expanded)} className="flex-shrink-0">
          {expanded
            ? <ChevronDown className="w-3 h-3 text-amber-600" />
            : <ChevronRight className="w-3 h-3 text-amber-600" />}
        </button>
        <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200 font-mono font-medium flex-shrink-0">
          NCM {exc.ncm || '—'}
        </span>
        <input
          type="text"
          value={exc.name || ''}
          onChange={e => onUpdateRuleName?.(exc.externalId, e.target.value)}
          className="text-[11px] font-medium text-ocean-180 bg-transparent border-none outline-none flex-1 truncate focus:bg-white focus:px-1.5 rounded transition-colors"
          title={exc.name}
        />
        <span className="text-[10px] text-ocean-100 flex-shrink-0">
          {excCount} {excCount === 1 ? 'item' : 'itens'}
        </span>
        <button
          onClick={() => onRemoveException?.(exc.externalId, parentRuleId)}
          className="text-ocean-40 hover:text-rose flex-shrink-0 p-0.5"
          title="Remover excecao (itens voltam para regra pai)"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Compact stats when collapsed */}
      {!expanded && excDets.length > 0 && (
        <div className="px-3 pb-2 flex items-center gap-2 text-[10px] text-ocean-100 flex-wrap">
          {excDets.map(d => (
            <span key={d.externalId} className="bg-white px-1.5 py-0.5 rounded border border-ocean-20">
              {d.codigoImposto} {d.aliquota}% CST {d.cst || '—'}
            </span>
          ))}
          <span className="ml-auto font-medium text-ocean-150">R$ {fmtBRL(excValue)}</span>
        </div>
      )}

      {/* Expanded: exception determinations */}
      {expanded && (
        <div className="border-t border-amber-200 px-3 py-2.5 space-y-2 bg-white/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-ocean-150 uppercase tracking-wide">
              Determinacoes
            </span>
            <button
              onClick={() => onAddDet?.(exc.externalId)}
              className="text-[10px] text-ocean-120 hover:text-ocean-180 font-medium flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Adicionar
            </button>
          </div>
          {excDets.length > 0 ? (
            <div className="space-y-1.5">
              {excDets.map(det => (
                <DeterminationCard key={det.externalId} det={det} onUpdateDet={onUpdateDet} onRemoveDet={onRemoveDet} paramTypeOptions={paramTypeOptions} />
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-ocean-100 text-center py-2 border border-dashed border-ocean-30 rounded">
              Nenhum imposto — clique em "Adicionar"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Determination card — reused in parent rules and exceptions */
function DeterminationCard({ det, onUpdateDet, onRemoveDet, paramTypeOptions }) {
  return (
    <div className="rounded-md border border-ocean-20 bg-ocean-5 p-2.5 space-y-2">
      {/* Row 1: Imposto + Aliq + CST + Delete */}
      <div className="flex items-center gap-2">
        <select
          value={det.codigoImposto || ''}
          onChange={e => onUpdateDet?.(det.externalId, 'codigoImposto', e.target.value)}
          className="text-[11px] px-1.5 py-1 border border-ocean-20 rounded bg-white focus:outline-none focus:ring-1 focus:ring-ocean-120 flex-1 min-w-0"
        >
          {TAX_CODES.map(tc => (
            <option key={tc.id} value={tc.id}>{tc.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-ocean-100 font-medium">Aliq</span>
          <input
            type="number"
            step="0.01"
            value={det.aliquota ?? 0}
            onChange={e => onUpdateDet?.(det.externalId, 'aliquota', parseFloat(e.target.value) || 0)}
            className="text-[11px] px-1 py-1 border border-ocean-20 rounded text-right bg-white focus:outline-none focus:ring-1 focus:ring-ocean-120 w-14"
          />
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] text-ocean-100 font-medium">CST</span>
          <input
            type="text"
            value={det.cst || ''}
            onChange={e => onUpdateDet?.(det.externalId, 'cst', e.target.value)}
            placeholder="—"
            className="text-[11px] font-mono px-1 py-1 border border-ocean-20 rounded text-center bg-white focus:outline-none focus:ring-1 focus:ring-ocean-120 w-12"
            title="Codigo de Situacao Tributaria"
          />
        </div>

        <button
          onClick={() => onRemoveDet?.(det.externalId)}
          className="text-ocean-40 hover:text-rose flex-shrink-0 p-0.5 transition-colors"
          title="Remover imposto"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 2: Tipo Parametro — full width */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-ocean-100 font-medium flex-shrink-0 w-20">
          Tipo Param.
        </span>
        <select
          value={det.tipoParametro || ''}
          onChange={e => onUpdateDet?.(det.externalId, 'tipoParametro', e.target.value)}
          className={`text-[11px] px-1.5 py-1 border rounded bg-white focus:outline-none focus:ring-1 focus:ring-ocean-120 flex-1 min-w-0 ${
            !det.tipoParametro
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-ocean-20'
          }`}
          title={!det.tipoParametro ? 'Tipo de parametro nao definido — selecione um valor' : det.tipoParametro}
        >
          <option value="">(nenhum)</option>
          {(paramTypeOptions || []).map(pt => (
            <option key={pt} value={pt}>{pt}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Sidebar direita (480px) com:
 * 1. Distribuicao Fiscal: cards com stats + mini-tabela CSTs + botao criar regra (com dedup)
 * 2. Regras Fiscais: cards com determinacoes em layout card (2 linhas por imposto)
 * 3. Bucket "Sem regra" + "+ Nova regra"
 */
export default function RuleBoxSidebar({
  rules, allRuleIds, items, groups, itemById,
  determinations, dropTargetRuleId,
  onDrop, onDragOver, onDragLeave,
  onCreateRuleFromGroup, onCreateAllRules, onRemoveRule, onUpdateRuleName,
  onUpdateDet, onRemoveDet, onAddDet, paramTypeOptions,
  onCreateException, onRemoveException,
}) {
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedRuleId, setExpandedRuleId] = useState(null);

  // Count items por regra
  const countByRule = new Map();
  const valueByRule = new Map();
  let unassignedCount = 0;
  let unassignedValue = 0;

  for (const item of items) {
    if (item._rejected) continue;
    if (!item.assignedRuleId) {
      unassignedCount++;
      unassignedValue += item.vlItem || 0;
    } else {
      countByRule.set(item.assignedRuleId, (countByRule.get(item.assignedRuleId) || 0) + 1);
      valueByRule.set(item.assignedRuleId, (valueByRule.get(item.assignedRuleId) || 0) + (item.vlItem || 0));
    }
  }

  // Existing rule keys for duplicate detection
  const existingRuleKeys = useMemo(() => {
    const keys = new Set();
    for (const r of rules) {
      keys.add(`${r.cfop}|${r.ufEmissor}|${r.ufDestinatario}`);
    }
    return keys;
  }, [rules]);

  // Lazy NCM breakdown for expanded group
  const ncmBreakdown = useMemo(() => {
    if (!expandedGroup || !itemById) return null;
    const group = groups.find(g => g.groupKey === expandedGroup);
    if (!group) return null;
    return computeNcmBreakdown(group.itemIds, itemById);
  }, [expandedGroup, groups, itemById]);

  // Dets indexed by ruleExternalId
  const detsByRule = useMemo(() => {
    const m = new Map();
    for (const d of (determinations || [])) {
      if (!m.has(d.ruleExternalId)) m.set(d.ruleExternalId, []);
      m.get(d.ruleExternalId).push(d);
    }
    return m;
  }, [determinations]);

  // NCM breakdown for items assigned to expanded rule (lazy)
  const ruleNcmBreakdown = useMemo(() => {
    if (!expandedRuleId || !itemById) return null;
    const assignedIds = new Set();
    for (const item of items) {
      if (!item._rejected && item.assignedRuleId === expandedRuleId) {
        assignedIds.add(item._itemId);
      }
    }
    if (assignedIds.size < 2) return null;
    return computeNcmBreakdown(assignedIds, itemById);
  }, [expandedRuleId, items, itemById]);

  // Separate parent rules from exceptions
  const parentRules = useMemo(() => rules.filter(r => !r._isException), [rules]);
  const exceptionsByParent = useMemo(() => {
    const m = new Map();
    for (const r of rules) {
      if (r._isException && r.parent) {
        if (!m.has(r.parent)) m.set(r.parent, []);
        m.get(r.parent).push(r);
      }
    }
    return m;
  }, [rules]);

  // Set of NCMs that already have exceptions under expanded rule
  const existingExceptionNcms = useMemo(() => {
    if (!expandedRuleId) return new Set();
    const ncms = new Set();
    const children = exceptionsByParent.get(expandedRuleId) || [];
    for (const c of children) {
      if (c.ncm) ncms.add(c.ncm);
    }
    return ncms;
  }, [expandedRuleId, exceptionsByParent]);

  return (
    <div className="space-y-5 overflow-y-auto max-h-[calc(100vh-260px)] pr-1">

      {/* ═══════════════ DISTRIBUIÇÃO FISCAL ═══════════════ */}
      {groups && groups.length > 0 && (() => {
        const pendingCount = groups.filter(g => !existingRuleKeys.has(`${g.cfop}|${g.emitUF}|${g.destUF}`)).length;
        return (
        <section>
          <div className="mb-3 px-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-ocean-180 uppercase tracking-wide flex items-center gap-1.5">
                Distribuicao Fiscal
                <span className="relative group">
                  <Info className="w-3 h-3 text-ocean-60 cursor-help" />
                  <span className="absolute left-4 top-0 z-10 hidden group-hover:block w-56 text-[11px] font-normal normal-case tracking-normal text-ocean-150 bg-white border border-ocean-30 rounded-lg shadow-lg p-2 leading-relaxed">
                    Padroes de ICMS encontrados automaticamente nas notas fiscais.
                    Cada grupo representa uma combinacao unica de CFOP e rota (UF origem → UF destino).
                  </span>
                </span>
              </h3>
              <span className="text-[11px] text-ocean-100">
                {groups.length} {groups.length === 1 ? 'padrao' : 'padroes'}
              </span>
            </div>

            {/* Batch create button */}
            {pendingCount > 0 ? (
              <button
                onClick={onCreateAllRules}
                className="w-full mt-2 py-2 text-xs font-semibold text-white bg-ocean-120 hover:bg-ocean-150 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar {pendingCount === 1 ? '1 regra' : `todas as ${pendingCount} regras`} automaticamente
              </button>
            ) : (
              <div className="w-full mt-2 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                Todas as regras foram criadas
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {groups.map(group => {
              const isExpanded = expandedGroup === group.groupKey;
              const groupRuleKey = `${group.cfop}|${group.emitUF}|${group.destUF}`;
              const alreadyHasRule = existingRuleKeys.has(groupRuleKey);

              return (
                <div key={group.groupKey} className="rounded-lg border border-ocean-30 bg-white overflow-hidden shadow-sm">

                  {/* Card header — clickable */}
                  <button
                    type="button"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.groupKey)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-ocean-5 hover:bg-ocean-20 transition-colors text-left"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-ocean-120 flex-shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-ocean-120 flex-shrink-0" />}
                    <span className="text-xs font-semibold text-ocean-150 bg-white px-2 py-0.5 rounded border border-ocean-30 font-mono">
                      CFOP {group.cfop}
                    </span>
                    {group.emitUF && group.destUF && (
                      <span className="text-xs text-ocean-120 font-medium">
                        {group.emitUF} → {group.destUF}
                      </span>
                    )}
                    <span className="ml-auto text-xs font-semibold text-ocean-150 whitespace-nowrap">
                      R$ {fmtBRL(group.totalValue)}
                    </span>
                  </button>

                  {/* Card body */}
                  <div className="px-3 py-3 space-y-3">

                    {/* Stats mini-grid */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-ocean-5 rounded-md px-2 py-2 text-center border border-ocean-20">
                        <div className="text-base font-bold text-ocean-180">{group.itemCount}</div>
                        <div className="text-[10px] text-ocean-100 uppercase tracking-wide">Itens</div>
                      </div>
                      <div className="bg-ocean-5 rounded-md px-2 py-2 text-center border border-ocean-20">
                        <div className="text-base font-bold text-ocean-180">{group.ncmCount}</div>
                        <div className="text-[10px] text-ocean-100 uppercase tracking-wide">NCMs</div>
                      </div>
                      <div className={`rounded-md px-2 py-2 text-center border ${
                        group.icmsEvidence.isConsistent
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-amber-50 border-amber-200'
                      }`}>
                        {group.icmsEvidence.isConsistent ? (
                          <>
                            <div className="text-base font-bold text-emerald-600">✓</div>
                            <div className="text-[10px] text-emerald-700 uppercase tracking-wide">Consistente</div>
                          </>
                        ) : (
                          <>
                            <div className="text-base font-bold text-amber-600">
                              {group.icmsEvidence.cstGroups.length}
                            </div>
                            <div className="text-[10px] text-amber-700 uppercase tracking-wide">CSTs dif.</div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* CST breakdown table */}
                    <div className="rounded-md border border-ocean-30 overflow-hidden">
                      <div className="grid grid-cols-[1fr_80px_48px] bg-ocean-10 px-3 py-1.5 text-[10px] font-semibold text-ocean-120 uppercase tracking-wide">
                        <span>CST</span>
                        <span>Aliquota</span>
                        <span className="text-right">Qtd</span>
                      </div>
                      {group.icmsEvidence.cstGroups.slice(0, isExpanded ? 20 : 3).map(cg => (
                        <div key={cg.cst} className="grid grid-cols-[1fr_80px_48px] px-3 py-1.5 border-t border-ocean-20 text-[11px] hover:bg-ocean-5">
                          <span className="font-mono text-ocean-180 font-medium">
                            {cg.cst === '_none' ? '(sem CST)' : `CST ${cg.cst}`}
                          </span>
                          <span className="text-ocean-120">
                            {cg.rates.map(r => `${r.aliq}%`).join(', ')}
                          </span>
                          <span className="text-right text-ocean-150 font-medium">{cg.count}</span>
                        </div>
                      ))}
                      {!isExpanded && group.icmsEvidence.cstGroups.length > 3 && (
                        <div className="px-3 py-1.5 border-t border-ocean-20 text-[10px] text-ocean-100 hover:text-ocean-150 cursor-pointer">
                          +{group.icmsEvidence.cstGroups.length - 3} mais — clique para expandir
                        </div>
                      )}
                    </div>

                    {/* Expanded: NCM breakdown */}
                    {isExpanded && ncmBreakdown && (
                      <div className="rounded-md border border-ocean-30 overflow-hidden">
                        <div className="bg-ocean-10 px-3 py-1.5 text-[10px] font-semibold text-ocean-120 uppercase tracking-wide flex items-center gap-1.5">
                          <span>Detalhamento por NCM</span>
                          <span className="text-ocean-60 normal-case font-normal tracking-normal">
                            (classificacao fiscal do produto)
                          </span>
                        </div>
                        {ncmBreakdown.ncmGroups.slice(0, 10).map(ng => (
                          <div key={ng.ncm} className="border-t border-ocean-20">
                            <div className="flex items-center justify-between px-3 py-1.5 text-[11px] bg-ocean-5">
                              <span className="font-mono text-ocean-180 font-medium">
                                {ng.ncm === '_sem_ncm' ? '(sem NCM)' : ng.ncm}
                              </span>
                              <span className="text-ocean-100">{ng.itemCount} itens</span>
                            </div>
                            {ng.taxTypes ? ng.taxTypes.map(tt => (
                              <div key={tt.taxType} className="pl-5 pr-3">
                                <div className="text-[9px] font-semibold text-ocean-100 uppercase tracking-wide pt-1 pb-0.5">{tt.taxType}</div>
                                {tt.cstGroups.map(cg => (
                                  <div key={cg.cst} className="flex items-center justify-between pl-2 pr-0 py-0.5 text-[10px]">
                                    <span className="text-ocean-120">CST {cg.cst === '_none' ? '—' : cg.cst}</span>
                                    <span className="text-ocean-100">
                                      {cg.rates.map(r => `${r.aliq}%`).join(', ')} ({cg.count})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )) : ng.cstGroups?.map(cg => (
                              <div key={cg.cst} className="flex items-center justify-between px-3 pl-6 py-1 text-[10px]">
                                <span className="text-ocean-120">CST {cg.cst === '_none' ? '—' : cg.cst}</span>
                                <span className="text-ocean-100">
                                  {cg.rates.map(r => `${r.aliq}%`).join(', ')} ({cg.count})
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                        {ncmBreakdown.ncmGroups.length > 10 && (
                          <div className="px-3 py-1.5 border-t border-ocean-20 text-[10px] text-ocean-60">
                            +{ncmBreakdown.ncmGroups.length - 10} NCMs adicionais
                          </div>
                        )}
                      </div>
                    )}

                    {/* Create rule button — disabled if already exists */}
                    {alreadyHasRule ? (
                      <div className="w-full text-xs text-center py-2 rounded-md border border-ocean-20 bg-ocean-5 text-ocean-100 flex items-center justify-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        Regra ja criada para esta operacao
                      </div>
                    ) : (
                      <button
                        onClick={() => onCreateRuleFromGroup?.(group)}
                        className="w-full text-xs text-center py-2 rounded-md border border-dashed border-ocean-120 text-ocean-120 hover:bg-ocean-10 hover:border-ocean-150 hover:text-ocean-150 transition-colors font-medium"
                      >
                        + Criar regra a partir deste padrao
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        );
      })()}

      {/* ═══════════════ DIVIDER ═══════════════ */}
      {groups && groups.length > 0 && rules.length > 0 && (
        <div className="border-t border-ocean-30 mx-1" />
      )}

      {/* ═══════════════ REGRAS FISCAIS ═══════════════ */}
      {rules.length > 0 && (
        <section>
          <div className="mb-3 px-1">
            <h3 className="text-xs font-semibold text-ocean-180 uppercase tracking-wide flex items-center gap-1.5">
              Regras Fiscais
              <span className="relative group">
                <Info className="w-3 h-3 text-ocean-60 cursor-help" />
                <span className="absolute left-4 top-0 z-10 hidden group-hover:block w-56 text-[11px] font-normal normal-case tracking-normal text-ocean-150 bg-white border border-ocean-30 rounded-lg shadow-lg p-2 leading-relaxed">
                  Cada regra define como o NetSuite calculara os impostos para um tipo de operacao.
                  Voce pode editar impostos, aliquotas e parametros em cada regra.
                </span>
              </span>
            </h3>
            <p className="text-[11px] text-ocean-100 mt-0.5 leading-relaxed">
              Arraste notas ou itens da lista para associar a uma regra
            </p>
          </div>

          <div className="space-y-2.5">
            {parentRules.map(rule => {
              const color = getRuleColor(rule.externalId, allRuleIds);
              const count = countByRule.get(rule.externalId) || 0;
              const value = valueByRule.get(rule.externalId) || 0;
              const isDropTarget = dropTargetRuleId === rule.externalId;
              const isRuleExpanded = expandedRuleId === rule.externalId;
              const ruleDets = detsByRule.get(rule.externalId) || [];
              const childExceptions = exceptionsByParent.get(rule.externalId) || [];
              const showNcmBreakdown = isRuleExpanded && ruleNcmBreakdown && ruleNcmBreakdown.ncmGroups.length > 1;

              return (
                <div key={rule.externalId} className="space-y-0">
                <div
                  data-rule-id={rule.externalId}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  className={`rounded-lg border bg-white overflow-hidden shadow-sm transition-all ${
                    isDropTarget
                      ? `ring-2 ${color.ring} border-transparent shadow-md`
                      : 'border-ocean-30 hover:border-ocean-60'
                  }`}
                >
                  {/* Colored top bar */}
                  <div className={`h-1 ${color.dot}`} />

                  {/* Header: expand + dot + name + delete */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      onClick={() => setExpandedRuleId(isRuleExpanded ? null : rule.externalId)}
                      className="flex-shrink-0"
                    >
                      {isRuleExpanded
                        ? <ChevronDown className={`w-3.5 h-3.5 ${color.text || 'text-ocean-120'}`} />
                        : <ChevronRight className={`w-3.5 h-3.5 ${color.text || 'text-ocean-120'}`} />}
                    </button>
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color.dot}`} />
                    <input
                      type="text"
                      value={rule.name || ''}
                      onChange={e => onUpdateRuleName?.(rule.externalId, e.target.value)}
                      className="text-xs font-semibold text-ocean-180 bg-transparent border-none outline-none flex-1 truncate focus:bg-ocean-5 focus:px-1.5 rounded transition-colors"
                      title={rule.name}
                    />
                    {childExceptions.length > 0 && (
                      <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 flex-shrink-0">
                        {childExceptions.length} exc.
                      </span>
                    )}
                    <button
                      onClick={() => onRemoveRule?.(rule.externalId)}
                      className="text-ocean-40 hover:text-rose flex-shrink-0 p-0.5"
                      title="Remover regra"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Route info + stats */}
                  <div className="px-3 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-ocean-150 bg-ocean-5 px-1.5 py-0.5 rounded border border-ocean-20">
                        CFOP {rule.cfop || '—'}
                      </span>
                      {rule.ufEmissor && rule.ufDestinatario && (
                        <span className="text-[11px] text-ocean-120 font-medium">
                          {rule.ufEmissor} → {rule.ufDestinatario}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-ocean-100">
                        {count} {count === 1 ? 'item' : 'itens'}
                      </span>
                      <span className="text-ocean-100">
                        {ruleDets.length} {ruleDets.length === 1 ? 'imposto' : 'impostos'}
                      </span>
                      <span className="text-ocean-180 font-semibold">
                        R$ {fmtBRL(value)}
                      </span>
                    </div>
                  </div>

                  {/* Expanded: determination cards */}
                  {isRuleExpanded && (
                    <div className="border-t border-ocean-20 px-3 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-ocean-150 uppercase tracking-wide flex items-center gap-1.5">
                          Impostos e Determinacoes
                          <span className="relative group">
                            <Info className="w-3 h-3 text-ocean-60 cursor-help" />
                            <span className="absolute left-4 top-0 z-10 hidden group-hover:block w-52 text-[11px] font-normal normal-case tracking-normal text-ocean-150 bg-white border border-ocean-30 rounded-lg shadow-lg p-2 leading-relaxed">
                              Cada card configura um imposto: codigo, aliquota, CST (situacao tributaria) e tipo de parametro (como o NetSuite calcula).
                            </span>
                          </span>
                        </span>
                        <button
                          onClick={() => onAddDet?.(rule.externalId)}
                          className="text-[11px] text-ocean-120 hover:text-ocean-180 font-medium flex items-center gap-0.5 transition-colors"
                        >
                          <Plus className="w-3 h-3" /> Adicionar
                        </button>
                      </div>

                      {/* Determination cards — 2 rows per tax */}
                      {ruleDets.length > 0 ? (
                        <div className="space-y-2">
                          {ruleDets.map(det => (
                            <DeterminationCard key={det.externalId} det={det} onUpdateDet={onUpdateDet} onRemoveDet={onRemoveDet} paramTypeOptions={paramTypeOptions} />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-md border border-dashed border-ocean-30 p-3 text-center">
                          <span className="text-[11px] text-ocean-100">
                            Nenhum imposto definido — clique em "Adicionar" acima
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expanded: NCM breakdown for assigned items */}
                  {showNcmBreakdown && (
                    <div className="border-t border-ocean-20 px-3 py-3">
                      <div className="text-[11px] font-semibold text-ocean-150 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        Detalhamento por NCM
                        <span className="relative group">
                          <Info className="w-3 h-3 text-ocean-60 cursor-help" />
                          <span className="absolute left-4 top-0 z-10 hidden group-hover:block w-56 text-[11px] font-normal normal-case tracking-normal text-ocean-150 bg-white border border-ocean-30 rounded-lg shadow-lg p-2 leading-relaxed">
                            NCMs com tratamento fiscal diferente podem precisar de uma excecao (regra filha). Clique em "Criar excecao" para separar.
                          </span>
                        </span>
                      </div>
                      <div className="rounded-md border border-ocean-30 overflow-hidden">
                        {ruleNcmBreakdown.ncmGroups.slice(0, 15).map(ng => {
                          const hasException = existingExceptionNcms.has(ng.ncm);
                          const canCreateException = !rule._isException && ruleNcmBreakdown.ncmGroups.length > 1 && !hasException && ng.ncm !== '_sem_ncm';
                          return (
                            <div key={ng.ncm} className={`border-t border-ocean-20 first:border-t-0 ${!ng.isConsistent ? 'bg-amber-50/50' : ''}`}>
                              <div className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-ocean-180 font-medium">
                                    {ng.ncm === '_sem_ncm' ? '(sem NCM)' : ng.ncm}
                                  </span>
                                  {!ng.isConsistent && (
                                    <span className="text-[9px] text-amber-600 bg-amber-100 px-1 py-0.5 rounded font-medium">
                                      Inconsistente
                                    </span>
                                  )}
                                  {hasException && (
                                    <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded font-medium">
                                      Excecao criada
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-ocean-100">{ng.itemCount} itens</span>
                                  {canCreateException && (
                                    <button
                                      onClick={() => {
                                        const ncmItemIds = new Set();
                                        for (const item of items) {
                                          if (!item._rejected && item.assignedRuleId === rule.externalId && item.ncm === ng.ncm) {
                                            ncmItemIds.add(item._itemId);
                                          }
                                        }
                                        onCreateException?.(rule.externalId, ng.ncm, ncmItemIds);
                                      }}
                                      className="text-[10px] text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded font-medium transition-colors"
                                    >
                                      Criar excecao
                                    </button>
                                  )}
                                </div>
                              </div>
                              {ng.taxTypes ? ng.taxTypes.map(tt => (
                                <div key={tt.taxType} className="pl-5 pr-3">
                                  <div className="text-[9px] font-semibold text-ocean-100 uppercase tracking-wide pt-1 pb-0.5">{tt.taxType}</div>
                                  {tt.cstGroups.map(cg => (
                                    <div key={cg.cst} className="flex items-center justify-between pl-2 pr-0 py-0.5 text-[10px]">
                                      <span className="text-ocean-120">CST {cg.cst === '_none' ? '—' : cg.cst}</span>
                                      <span className="text-ocean-100">
                                        {cg.rates.map(r => `${r.aliq}%`).join(', ')} ({cg.count})
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )) : ng.cstGroups?.map(cg => (
                                <div key={cg.cst} className="flex items-center justify-between px-3 pl-6 py-1 text-[10px]">
                                  <span className="text-ocean-120">CST {cg.cst === '_none' ? '—' : cg.cst}</span>
                                  <span className="text-ocean-100">
                                    {cg.rates.map(r => `${r.aliq}%`).join(', ')} ({cg.count})
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {ruleNcmBreakdown.ncmGroups.length > 15 && (
                          <div className="px-3 py-1.5 border-t border-ocean-20 text-[10px] text-ocean-60">
                            +{ruleNcmBreakdown.ncmGroups.length - 15} NCMs adicionais
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Nested exceptions under this parent ── */}
                {isRuleExpanded && childExceptions.length > 0 && (
                  <div className="ml-4 mt-1 space-y-1.5">
                    {childExceptions.map(exc => (
                      <ExceptionCard
                        key={exc.externalId}
                        exc={exc}
                        allRuleIds={allRuleIds}
                        countByRule={countByRule}
                        valueByRule={valueByRule}
                        detsByRule={detsByRule}
                        dropTargetRuleId={dropTargetRuleId}
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        onUpdateRuleName={onUpdateRuleName}
                        onUpdateDet={onUpdateDet}
                        onRemoveDet={onRemoveDet}
                        onAddDet={onAddDet}
                        onRemoveException={onRemoveException}
                        parentRuleId={rule.externalId}
                        paramTypeOptions={paramTypeOptions}
                      />
                    ))}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ UNASSIGNED BUCKET ═══════════════ */}
      <div
        data-rule-id="__unassigned__"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-lg border p-3 transition-all ${
          dropTargetRuleId === '__unassigned__'
            ? `ring-2 ${UNASSIGNED_COLOR.ring} border-transparent bg-white shadow-md`
            : 'border-dashed border-ocean-30 bg-ocean-5 hover:border-ocean-60'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${UNASSIGNED_COLOR.dot}`} />
          <span className="text-xs font-medium text-ocean-100">Sem regra</span>
          <span className="ml-auto text-[11px] text-ocean-100">
            {unassignedCount} {unassignedCount === 1 ? 'item' : 'itens'}
            {unassignedCount > 0 && (
              <span className="ml-1 font-medium text-ocean-150">
                — R$ {fmtBRL(unassignedValue)}
              </span>
            )}
          </span>
        </div>
        {unassignedCount > 0 && (
          <p className="text-[10px] text-ocean-60 mt-1.5 leading-relaxed">
            Arraste estes itens para uma regra acima, ou crie uma nova regra
          </p>
        )}
      </div>

      {/* ═══════════════ NEW RULE DROP ZONE ═══════════════ */}
      <div
        data-rule-id="__new__"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-lg border border-dashed p-3 flex items-center justify-center gap-1.5 transition-all ${
          dropTargetRuleId === '__new__'
            ? 'ring-2 ring-ocean-120 border-transparent bg-ocean-10 shadow-md'
            : 'border-ocean-30 hover:border-ocean-60 text-ocean-60 hover:text-ocean-120'
        }`}
      >
        <Plus className="w-4 h-4" />
        <span className="text-xs font-medium">Nova regra</span>
      </div>
    </div>
  );
}
