import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Loader2, Download, FileSpreadsheet,
  ChevronDown, ChevronRight, Plus, Trash2, AlertTriangle,
  CheckCircle, AlertCircle, FileText, X, Upload, Info,
  Users, Calendar, BarChart3,
} from 'lucide-react';
import XmlFileUploader from '../components/XmlFileUploader.jsx';
import { parseNFeFiles } from '../../parsers/nfe-parser.js';
import { generateTaxRules } from '../../services/tax-rule-generator.js';
import { downloadXLSX, downloadCSVs } from '../../services/tax-rule-exporter.js';
import { REGIMES, LOBS, TAX_CODES, PARAM_TYPES } from '../../data/tax-reference.js';
import { sendToBackground } from '../../utils/api-client.js';
import RawFileViewer from '../components/RawFileViewer.jsx';
import InvoiceExplorer from '../components/InvoiceExplorer.jsx';
import { buildRuleAlerts } from '../../utils/rule-alerts.js';
import { translateWarning } from '../../utils/warning-translator.js';

// ── SPED Processing Summary ─────────────────────────────────────────────────

function SpedSummary({ rawStats, qualityStats, companyInfo }) {
  const [expanded, setExpanded] = useState(false);

  if (!rawStats || !qualityStats) return null;

  // Agregar rawStats de multiplos arquivos
  const totalDocs = rawStats.reduce((s, r) => s + (r.documentsRead || 0), 0);
  const acceptedDocs = rawStats.reduce((s, r) => s + (r.documentsAccepted || 0), 0);
  const rejectedDocs = rawStats.reduce((s, r) => s + (r.documentsRejectedByStatus || 0), 0);
  const totalLines = rawStats.reduce((s, r) => s + (r.totalLines || 0), 0);

  return (
    <div className="bg-ocean-10 rounded-lg p-3 space-y-2">
      {companyInfo && (
        <p className="text-xs text-ocean-150">
          Empresa: <span className="font-medium">{companyInfo.nome}</span> — CNPJ: {companyInfo.cnpj} — UF: {companyInfo.uf}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-base font-bold text-ocean-180">{acceptedDocs}</p>
          <p className="text-xs text-ocean-60">Docs aceitos</p>
        </div>
        <div>
          <p className="text-base font-bold text-ocean-180">{qualityStats.itemsAccepted}</p>
          <p className="text-xs text-ocean-60">Itens aceitos</p>
        </div>
        <div>
          <p className="text-base font-bold text-golden">{qualityStats.itemsRejected}</p>
          <p className="text-xs text-ocean-60">Itens rejeitados</p>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-1"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Detalhes
      </button>

      {expanded && (
        <div className="text-xs text-ocean-150 space-y-1 border-t border-ocean-30 pt-2">
          <p>{totalLines.toLocaleString()} linhas lidas em {rawStats.length} arquivo(s)</p>
          <p>Documentos: {totalDocs} lidos, {acceptedDocs} aceitos, {rejectedDocs} rejeitados por status</p>
          <p>CFOPs unicos: {qualityStats.uniqueCFOPs} | NCMs unicos: {qualityStats.uniqueNCMs} | UFs: {qualityStats.uniqueUFs}</p>

          {qualityStats.itemsWarning > 0 && (
            <p className="text-yellow-600">
              {qualityStats.itemsWarning} itens com avisos
              {qualityStats.warningReasons && Object.keys(qualityStats.warningReasons).length > 0 && (
                <span> ({Object.entries(qualityStats.warningReasons).map(([k, v]) => `${k}: ${v}`).join(', ')})</span>
              )}
            </p>
          )}

          {qualityStats.itemsRejected > 0 && qualityStats.rejectionReasons && (
            <p className="text-rose">
              Rejeicoes: {Object.entries(qualityStats.rejectionReasons).map(([k, v]) => `${k}: ${v}`).join(', ')}
            </p>
          )}

          {rawStats.some(r => r.skippedByCodSit && Object.keys(r.skippedByCodSit).length > 0) && (
            <p>
              COD_SIT ignorados: {(() => {
                const agg = rawStats.flatMap(r => Object.entries(r.skippedByCodSit || {}))
                  .reduce((acc, [k, v]) => { acc[k] = (acc[k] || 0) + v; return acc; }, {});
                return Object.entries(agg).map(([k, v]) => `${k}: ${v}`).join(', ');
              })()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── SPED Quality Gate ────────────────────────────────────────────────────────

function SpedQualityGate({ qualityStats, onAcknowledge, onBack }) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!qualityStats) return null;

  const noIcmsCst = qualityStats.warningReasons?.noIcmsCst || 0;
  const invalidNcm = qualityStats.warningReasons?.invalidNcm || 0;
  const cfopBreakdown = qualityStats.noIcmsCstByCfop || {};
  const cfopEntries = Object.entries(cfopBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-rose/30 p-4 space-y-4">
        <div className="flex items-center gap-2 text-rose">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <h3 className="font-semibold text-sm">Diagnostico de Qualidade do SPED</h3>
        </div>

        {/* Blocking: CST ausente */}
        {noIcmsCst > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-red-800">
              {noIcmsCst.toLocaleString()} {noIcmsCst === 1 ? 'item' : 'itens'} sem CST de ICMS no registro C170
            </p>
            <p className="text-xs text-red-700">
              O campo CST_ICMS (campo 10 do C170) esta vazio no arquivo SPED. Esse campo e obrigatorio para documentos regulares (COD_SIT 00/01). Sem ele, o sistema nao consegue gerar regras de ICMS corretas para esses itens.
            </p>
            {cfopEntries.length > 0 && (
              <div className="text-xs text-red-700">
                <p className="font-medium mb-1">Breakdown por CFOP:</p>
                <div className="flex flex-wrap gap-2">
                  {cfopEntries.map(([cfop, count]) => (
                    <span key={cfop} className="bg-red-100 px-2 py-0.5 rounded font-mono">
                      {cfop}: {count} {count === 1 ? 'item' : 'itens'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Warning: NCM invalido */}
        {invalidNcm > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm font-medium text-amber-800">
              {invalidNcm.toLocaleString()} {invalidNcm === 1 ? 'item' : 'itens'} com NCM invalido (00000000)
            </p>
            <p className="text-xs text-amber-700 mt-1">
              NCM placeholder nao permite gerar excecoes fiscais por produto. Atualize o cadastro de itens no ERP.
            </p>
          </div>
        )}

        {/* Recomendacao */}
        <div className="bg-ocean-10 rounded-lg p-3 flex items-start gap-2">
          <Info className="w-4 h-4 text-ocean-120 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-ocean-150">
            <span className="font-medium">Recomendacao:</span> Corrija a parametrizacao do ERP de origem ou solicite ao escritorio contabil que revise o SPED antes de importar. Itens sem CST de ICMS serao agrupados como "(sem CST)" na revisao.
          </p>
        </div>

        {/* Acknowledge checkbox */}
        <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-ocean-20">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 accent-ocean-120"
          />
          <span className="text-xs text-ocean-150">
            Estou ciente dos problemas de qualidade e desejo prosseguir com os dados disponiveis
          </span>
        </label>

        {/* Actions */}
        <div className="flex justify-between pt-1">
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-ocean-120 hover:text-ocean-180 border border-ocean-30 rounded-lg hover:bg-ocean-10"
          >
            <ArrowLeft className="w-3 h-3" /> Voltar
          </button>
          <button
            onClick={onAcknowledge}
            disabled={!acknowledged}
            className="flex items-center gap-1 px-4 py-1.5 text-xs text-white bg-ocean-120 rounded-lg hover:bg-ocean-150 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prosseguir <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Block M Validation Banner ────────────────────────────────────────────────

function BlockMBanner({ validation }) {
  const [expanded, setExpanded] = useState(false);

  if (!validation || !validation.summary) return null;

  const { summary, matches } = validation;
  const warningMatches = (matches || []).filter(m => m.severity === 'warning');
  const hasWarnings = warningMatches.length > 0;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      hasWarnings ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasWarnings
            ? <AlertTriangle className="w-4 h-4 text-amber-600" />
            : <CheckCircle className="w-4 h-4 text-green-600" />
          }
          <span className={`text-sm font-medium ${hasWarnings ? 'text-amber-800' : 'text-green-800'}`}>
            Validacao Bloco M {hasWarnings ? `— ${warningMatches.length} aviso(s)` : '— OK'}
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-0.5"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Recolher' : 'Detalhes'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="font-bold text-ocean-180">{Math.round((summary.coverage || 0) * 100)}%</p>
          <p className="text-ocean-60">Cobertura NAT</p>
        </div>
        <div>
          <p className="font-bold text-green-700">{summary.okCount || 0}</p>
          <p className="text-ocean-60">NATs OK</p>
        </div>
        <div>
          <p className="font-bold text-amber-600">{summary.warningCount || 0}</p>
          <p className="text-ocean-60">NATs com aviso</p>
        </div>
      </div>

      {expanded && matches && matches.length > 0 && (
        <div className="border-t border-ocean-30 pt-2 space-y-1">
          {matches.map((m, i) => (
            <div key={i} className={`text-xs flex items-center gap-2 ${
              m.severity === 'warning' ? 'text-amber-700' : 'text-green-700'
            }`}>
              {m.severity === 'warning'
                ? <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                : <CheckCircle className="w-3 h-3 flex-shrink-0" />
              }
              <span>
                NAT {m.nat}: oficial R$ {(m.officialBase || 0).toLocaleString('pt-BR')}{' '}
                vs calculado R$ {(m.calculatedBase || 0).toLocaleString('pt-BR')}{' '}
                (diff: {m.diffPercent != null ? `${m.diffPercent.toFixed(1)}%` : 'N/A'})
              </span>
            </div>
          ))}

          {summary.sourcesUsed && (
            <div className="text-xs text-ocean-100 mt-1 pt-1 border-t border-ocean-30">
              Fontes: {Object.entries(summary.sourcesUsed).map(([k, v]) => `${k}: ${v}`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Needs Review Banner ─────────────────────────────────────────────────────

const REASON_CONFIG = {
  DEST_UF_MISSING: { label: 'UF destino ausente', color: 'text-rose', bg: 'bg-rose/10', severity: 'grave' },
  CONFLICT_SAME_NCM: { label: 'Conflito mesmo NCM', color: 'text-orange-700', bg: 'bg-orange-50', severity: 'medio' },
  EMIT_UF_MISSING: { label: 'UF emissor ausente', color: 'text-amber-700', bg: 'bg-amber-50', severity: 'leve' },
  CFOP_INVALID: { label: 'CFOP invalido', color: 'text-amber-700', bg: 'bg-amber-50', severity: 'leve' },
  OP_UNKNOWN: { label: 'Operacao desconhecida', color: 'text-amber-700', bg: 'bg-amber-50', severity: 'leve' },
  PARAMTYPE_MISSING: { label: 'Param. tipo ausente (ICMS ST)', color: 'text-orange-700', bg: 'bg-orange-50', severity: 'medio' },
};

function NeedsReviewBanner({ needsReview }) {
  const [expanded, setExpanded] = useState(false);
  const byReason = needsReview.byReason || {};
  const totalItems = needsReview.items?.length || 0;

  if (totalItems === 0) return null;

  const hasGrave = !!byReason.DEST_UF_MISSING;

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${
      hasGrave ? 'border-rose/30 bg-rose/5' : 'border-amber-200 bg-amber-50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-4 h-4 ${hasGrave ? 'text-rose' : 'text-amber-600'}`} />
          <span className={`text-sm font-medium ${hasGrave ? 'text-rose' : 'text-amber-800'}`}>
            {totalItems} ite{totalItems === 1 ? 'm' : 'ns'} necessitam revisao
          </span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-0.5"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {expanded ? 'Recolher' : 'Detalhes'}
        </button>
      </div>

      <div className="space-y-1">
        {Object.entries(byReason)
          .sort((a, b) => {
            const order = { DEST_UF_MISSING: 0, CONFLICT_SAME_NCM: 1, EMIT_UF_MISSING: 2, CFOP_INVALID: 3, OP_UNKNOWN: 4 };
            return (order[a[0]] ?? 9) - (order[b[0]] ?? 9);
          })
          .map(([reason, data]) => {
            const cfg = REASON_CONFIG[reason] || { label: reason, color: 'text-ocean-150', bg: 'bg-ocean-10' };
            return (
              <div key={reason} className={`flex items-center justify-between rounded px-2 py-1 ${cfg.bg}`}>
                <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className={cfg.color}>{data.count} ite{data.count === 1 ? 'm' : 'ns'}</span>
                  <span className="text-ocean-100">R$ {data.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            );
          })}
      </div>

      {expanded && needsReview.items && needsReview.items.length > 0 && (
        <div className="border-t border-ocean-30 pt-2 max-h-40 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ocean-100">
                <th className="text-left px-1 py-0.5">Motivo</th>
                <th className="text-left px-1 py-0.5">CFOP</th>
                <th className="text-left px-1 py-0.5">NCM</th>
                <th className="text-right px-1 py-0.5">Valor</th>
              </tr>
            </thead>
            <tbody>
              {needsReview.items.slice(0, 50).map((nr, i) => {
                const cfg = REASON_CONFIG[nr.reason] || { color: 'text-ocean-150' };
                return (
                  <tr key={i} className="border-t border-ocean-10">
                    <td className={`px-1 py-0.5 ${cfg.color}`}>{cfg.label || nr.reason}</td>
                    <td className="px-1 py-0.5 text-ocean-150">{nr.item?.cfop || nr.item?.cfopOriginal || '—'}</td>
                    <td className="px-1 py-0.5 text-ocean-150">{nr.item?.ncm || '—'}</td>
                    <td className="px-1 py-0.5 text-right text-ocean-150">
                      {nr.vlItem ? `R$ ${nr.vlItem.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {needsReview.items.length > 50 && (
            <p className="text-xs text-ocean-60 mt-1 text-center">
              Mostrando 50 de {needsReview.items.length} itens
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Etapa 1: Upload + Config ────────────────────────────────────────────────

function StepUpload({
  source, files, setFiles, config, setConfig, spedOptions, setSpedOptions,
  onProcess, processing, parseErrors, subsidiaries, subsLoading,
  spedProgress, spedSummary,
  xmlProgress, processingPhase, onCancelXml,
  lookupsStatus, lookupsError,
}) {
  const isSped = source === 'sped';

  return (
    <div className="space-y-4">
      {/* Uploader */}
      {isSped ? (
        <XmlFileUploader
          onFilesChanged={setFiles}
          accept=".txt"
          label="Arraste arquivos SPED EFD (.txt) aqui ou clique para selecionar"
          subtitle="Aceita multiplos arquivos .txt do mesmo CNPJ"
          maxFileSize={500 * 1024 * 1024}
        />
      ) : (
        <XmlFileUploader onFilesChanged={setFiles} />
      )}

      {/* SPED-specific options */}
      {isSped && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1 text-sm text-blue-700 font-medium">
            <Info className="w-4 h-4" />
            Opcoes do SPED EFD
          </div>
          <p className="text-xs text-blue-600">
            O SPED nao informa o regime do fornecedor. Regras nao serao segmentadas por regime do emissor.
          </p>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs text-ocean-150">
              <input type="checkbox" checked disabled className="rounded" />
              Regulares e extemporaneos (COD_SIT 00, 01)
            </label>
            <label className="flex items-center gap-2 text-xs text-ocean-150">
              <input
                type="checkbox"
                checked={spedOptions.includeComplementary}
                onChange={(e) => setSpedOptions(o => ({ ...o, includeComplementary: e.target.checked }))}
                className="rounded"
              />
              Incluir complementares (COD_SIT 06, 07)
            </label>
            <label className="flex items-center gap-2 text-xs text-ocean-150">
              <input
                type="checkbox"
                checked={spedOptions.includeSpecialRegime}
                onChange={(e) => setSpedOptions(o => ({ ...o, includeSpecialRegime: e.target.checked }))}
                className="rounded"
              />
              Incluir regime especial (COD_SIT 08)
            </label>
            <label className="flex items-center gap-2 text-xs text-ocean-150">
              <input
                type="checkbox"
                checked={spedOptions.requireNcm}
                onChange={(e) => setSpedOptions(o => ({ ...o, requireNcm: e.target.checked }))}
                className="rounded"
              />
              Exigir NCM para gerar regra (itens sem NCM serao rejeitados)
            </label>
            <label className="flex items-center gap-2 text-xs text-ocean-150">
              <input
                type="checkbox"
                checked={spedOptions.useNcmNetSuite}
                onChange={(e) => setSpedOptions(o => ({ ...o, useNcmNetSuite: e.target.checked }))}
                className="rounded"
              />
              Enriquecer NCM com cadastro NetSuite (prioriza NCM do item no NS)
            </label>
          </div>
        </div>
      )}

      {/* Config do cliente */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
        <h3 className="text-sm font-medium text-ocean-150 uppercase tracking-wide">Dados do Cliente</h3>

        <div>
          <label className="block text-xs text-ocean-150 mb-1">Subsidiaria</label>
          {subsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-ocean-30 rounded-md text-sm text-ocean-60">
              <Loader2 className="w-3 h-3 animate-spin" />
              Carregando subsidiarias...
            </div>
          ) : subsidiaries.length > 0 ? (
            <select
              value={config.subsidiaryName}
              onChange={(e) => {
                const selected = subsidiaries.find(s => s.name === e.target.value);
                setConfig(c => ({ ...c, subsidiaryName: e.target.value, subsidiaryCnpj: selected?.cnpj || '' }));
              }}
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            >
              <option value="">Selecione uma subsidiaria</option>
              {subsidiaries.map(s => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={config.subsidiaryName}
              onChange={(e) => setConfig(c => ({ ...c, subsidiaryName: e.target.value }))}
              placeholder="Nome da empresa no NetSuite"
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {!isSped && (
            <div>
              <label className="block text-xs text-ocean-150 mb-1">Regime do Emissor</label>
              <select
                value={config.regimeEmissor}
                onChange={(e) => setConfig(c => ({ ...c, regimeEmissor: e.target.value }))}
                className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
              >
                {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          <div className={isSped ? 'col-span-2' : ''}>
            <label className="block text-xs text-ocean-150 mb-1">
              Regime do {isSped ? 'Declarante (Destinatario)' : 'Destinatario'}
            </label>
            <select
              value={config.regimeDestinatario}
              onChange={(e) => setConfig(c => ({ ...c, regimeDestinatario: e.target.value }))}
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            >
              {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {!isSped && (
            <div>
              <label className="block text-xs text-ocean-150 mb-1">Linha de Negocio do Emissor</label>
              <select
                value={config.lobEmissor}
                onChange={(e) => setConfig(c => ({ ...c, lobEmissor: e.target.value }))}
                className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
              >
                <option value="">Nao informar</option>
                {LOBS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}
          <div className={isSped ? 'col-span-2' : ''}>
            <label className="block text-xs text-ocean-150 mb-1">
              Linha de Negocio do {isSped ? 'Declarante' : 'Destinatario'}
            </label>
            <select
              value={config.lobDestinatario}
              onChange={(e) => setConfig(c => ({ ...c, lobDestinatario: e.target.value }))}
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
            >
              <option value="">Nao informar</option>
              {LOBS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-ocean-150 mb-1">Valido a partir de</label>
          <input
            type="date"
            value={config.validoAPartirDe}
            onChange={(e) => setConfig(c => ({ ...c, validoAPartirDe: e.target.value }))}
            className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120 focus:border-transparent"
          />
        </div>
      </div>

      {/* SPED progress */}
      {isSped && spedProgress && (
        <div className="bg-white rounded-lg border border-ocean-30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-ocean-150">
            <Loader2 className="w-4 h-4 animate-spin" />
            {spedProgress.detail || 'Processando...'}
          </div>
          <div className="w-full bg-ocean-30 rounded-full h-2">
            <div
              className="bg-ocean-120 h-2 rounded-full transition-all duration-300"
              style={{ width: `${spedProgress.percent || 0}%` }}
            />
          </div>
        </div>
      )}

      {/* XML progress */}
      {!isSped && processing && (processingPhase || xmlProgress) && (
        <div className="bg-white rounded-lg border border-ocean-30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-ocean-150">
              <Loader2 className="w-4 h-4 animate-spin" />
              {processingPhase === 'generating'
                ? 'Consolidando regras...'
                : xmlProgress
                  ? `Lendo XML ${xmlProgress.current} de ${xmlProgress.total}...`
                  : 'Processando...'
              }
            </div>
            {processingPhase === 'parsing' && onCancelXml && (
              <button
                onClick={onCancelXml}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Cancelar
              </button>
            )}
          </div>
          {xmlProgress && processingPhase === 'parsing' && (
            <>
              <div className="w-full bg-ocean-30 rounded-full h-2">
                <div
                  className="bg-ocean-120 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((xmlProgress.current / xmlProgress.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-ocean-60 truncate">{xmlProgress.fileName}</p>
            </>
          )}
        </div>
      )}

      {/* SPED summary */}
      {isSped && spedSummary && (
        <SpedSummary
          rawStats={spedSummary.rawStats}
          qualityStats={spedSummary.qualityStats}
          companyInfo={spedSummary.companyInfo}
        />
      )}

      {/* Erros de parse */}
      {parseErrors.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1 text-sm text-yellow-700 font-medium">
            <AlertTriangle className="w-4 h-4" />
            Avisos no processamento
          </div>
          {parseErrors.map((pe, i) => (
            <p key={i} className="text-xs text-yellow-600">{pe.fileName}: {pe.errors.join('; ')}</p>
          ))}
        </div>
      )}

      <button
        onClick={onProcess}
        disabled={files.length === 0 || processing || (lookupsStatus !== 'ready' && lookupsStatus !== 'error')}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (lookupsStatus === 'loading' || lookupsStatus === 'idle') ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
        {processing
          ? (isSped ? 'Processando SPED...' : 'Processando XMLs...')
          : (lookupsStatus === 'loading' || lookupsStatus === 'idle')
            ? 'Carregando dados do NetSuite...'
            : `Processar ${files.length} arquivo${files.length > 1 ? 's' : ''}`
        }
      </button>

      {lookupsStatus === 'error' && (
        <p className="text-xs text-amber-600 mt-1">
          Nao foi possivel carregar Param Types do NetSuite{lookupsError ? `: ${lookupsError}` : ''}.
          CBS/IBS serao processados sem validacao de nomes.
        </p>
      )}
    </div>
  );
}

// ── Etapa 2: Review ─────────────────────────────────────────────────────────

function RuleCard({ rule, dets, onUpdateRule, onUpdateDet, onRemoveRule, onRemoveDet, onAddDet, paramTypeOptions, hasReformData }) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

  const hasConflicts = rule.conflicts && rule.conflicts.length > 0;
  const hasEvidence = rule.evidence && rule.evidence.itemCount > 0;
  const [sigExpanded, setSigExpanded] = useState(rule.hasConflict || false);
  const [clusterExpanded, setClusterExpanded] = useState(false);

  // Confidence badge
  const confidence = rule.confidenceScore;
  const confidenceBadge = confidence != null ? (
    confidence >= 90
      ? { label: 'Alta', bg: 'bg-emerald-100', text: 'text-emerald-700' }
      : confidence >= 70
        ? { label: 'Media', bg: 'bg-yellow-100', text: 'text-yellow-700' }
        : { label: 'Baixa', bg: 'bg-red-100', text: 'text-red-700' }
  ) : null;

  return (
    <div className={`bg-white rounded-lg border ${rule._isException ? 'border-golden' : hasConflicts ? 'border-orange-300' : 'border-ocean-30'}`}>
      {/* Header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-ocean-10 rounded-t-lg"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-ocean-120 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ocean-120 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-ocean-180 truncate">{rule.name}</p>
            {rule._isException && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded flex-shrink-0" title="Regra especifica por NCM porque a tributacao difere da regra geral.">
                Excecao NCM
              </span>
            )}
            {hasConflicts && (
              <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded flex-shrink-0" title="Mesma operacao com tributacoes diferentes. Decida qual e a correta.">
                Conflito
              </span>
            )}
            {rule.hasConflict && !hasConflicts && (
              <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded flex-shrink-0" title="Itens tributados de formas diferentes. Verifique se precisa criar excecoes.">
                Multi-assinatura
              </span>
            )}
            {confidenceBadge && (
              <span className={`text-xs ${confidenceBadge.bg} ${confidenceBadge.text} px-1.5 py-0.5 rounded flex-shrink-0`} title={`${Math.round(confidence)}% dos itens tem a mesma tributacao. Quanto maior, mais consistente.`}>
                {Math.round(confidence)}% {confidenceBadge.label}
              </span>
            )}
            {rule._passiveTaxes?.some(t => t._stUpstream) && (
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0" title="ICMS-ST ja recolhido pelo fornecedor. Informativo — nao vira regra.">
                ST upstream
              </span>
            )}
            {rule._reducaoBCStats && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                  rule._reducaoBCStats.confidence === 'high'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
                title="Reducao calculada (nao oficial). Conferir com legislacao."
              >
                Reducao ~{rule._reducaoBCStats.mean}%{rule._reducaoBCStats.confidence !== 'high' ? ' (verificar)' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-ocean-60 mt-0.5 flex-wrap">
            <span>CFOP {rule.cfop}</span>
            <span>{rule.ufEmissor} → {rule.ufDestinatario}</span>
            {rule.ruleStats ? (
              <>
                <span>{rule.ruleStats.items} itens</span>
                <span>{rule.ruleStats.documents}{rule.ruleStats.documentsApprox ? '+' : ''} docs</span>
                {rule.ruleStats.uniqueNCM > 0 && <span>{rule.ruleStats.uniqueNCM} NCMs</span>}
              </>
            ) : (
              <span>{rule._nfeCount} ocorrencia{rule._nfeCount > 1 ? 's' : ''}</span>
            )}
            <span>{dets.length} imposto{dets.length > 1 ? 's' : ''}</span>
            {hasEvidence && rule.evidence.uniqueSuppliers > 0 && (
              <span className="flex items-center gap-0.5">
                <Users className="w-3 h-3" />
                {rule.evidence.uniqueSuppliers} fornecedor{rule.evidence.uniqueSuppliers > 1 ? 'es' : ''}
              </span>
            )}
            {hasEvidence && rule.evidence.firstSeen && (
              <span className="flex items-center gap-0.5">
                <Calendar className="w-3 h-3" />
                {rule.evidence.firstSeen} → {rule.evidence.lastSeen}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onRemoveRule(); }}
          className="text-ocean-60 hover:text-rose flex-shrink-0 p-1"
          title="Remover regra"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Detalhes (expandido) */}
      {expanded && (
        <div className="border-t border-ocean-30 p-3 space-y-3">
          {/* Conflitos */}
          {hasConflicts && (
            <div className="bg-orange-50 border border-orange-200 rounded p-2 space-y-1">
              <p className="text-xs font-medium text-orange-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Conflitos detectados
              </p>
              {rule.conflicts.map((conflict, ci) => (
                <div key={ci} className="text-xs text-orange-600">
                  <span className="font-medium">{conflict.taxType}:</span>
                  {conflict.conflictType === 'passive_active' ? (
                    <span className="ml-1">
                      {conflict.detail?.passive || 0} itens passivos vs {conflict.detail?.active || 0} ativos
                    </span>
                  ) : conflict.signatures ? (
                    conflict.signatures.slice(0, 3).map((sig, si) => (
                      <span key={si} className="ml-1">
                        CST {sig.cst} / {sig.aliq}% ({sig.percent}%, {sig.count}x)
                        {si < Math.min(conflict.signatures.length, 3) - 1 && ' vs'}
                      </span>
                    ))
                  ) : (
                    <span className="ml-1">{conflict.conflictType}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Distribuicao de Assinaturas */}
          {rule.signatureSummary && rule.signatureSummary.length > 1 && (
            <div>
              <button
                onClick={() => setSigExpanded(!sigExpanded)}
                className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-1"
              >
                <BarChart3 className="w-3 h-3" />
                {sigExpanded ? 'Ocultar assinaturas' : `Ver assinaturas (${rule.signatureSummary.length})`}
              </button>
              {sigExpanded && (
                <div className="mt-1 space-y-1">
                  {rule.signatureSummary.map((sig, si) => (
                    <div key={si} className="flex items-center gap-2 text-xs">
                      <div className="w-full max-w-[200px] bg-ocean-10 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-3 rounded-full ${sig.isMain ? 'bg-ocean-120' : 'bg-ocean-60'}`}
                          style={{ width: `${Math.max(sig.percent, 2)}%` }}
                        />
                      </div>
                      <span className="text-ocean-150 whitespace-nowrap">
                        {sig.percent}% ({sig.count}x)
                        {sig.isMain && <span className="ml-1 text-ocean-120 font-medium">principal</span>}
                      </span>
                      <span className="text-ocean-60 truncate" title={sig.signature}>
                        {sig.taxes.map(t => `${t.type} ${t.cst} ${t.aliq}%`).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* NCM Clusters */}
          {rule.ncmClusters && rule.ncmClusters.length > 0 && !rule._isException && (
            <div>
              <button
                onClick={() => setClusterExpanded(!clusterExpanded)}
                className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-1"
              >
                <FileText className="w-3 h-3" />
                {clusterExpanded ? 'Ocultar NCMs' : `Ver NCMs (${rule.ncmClusters.length})`}
              </button>
              {clusterExpanded && (
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-ocean-60 border-b border-ocean-30">
                        <th className="text-left py-1 pr-2">NCM</th>
                        <th className="text-right py-1 px-2">Itens</th>
                        <th className="text-right py-1 px-2">Valor</th>
                        <th className="text-right py-1 px-2">Dominante</th>
                        <th className="text-center py-1 pl-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rule.ncmClusters.slice(0, 20).map((cl, ci) => (
                        <tr key={ci} className="border-b border-ocean-10">
                          <td className="py-1 pr-2 font-mono text-ocean-150">{cl.ncm}</td>
                          <td className="text-right py-1 px-2 text-ocean-150">{cl.itemCount}</td>
                          <td className="text-right py-1 px-2 text-ocean-150">{cl.totalValue.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                          <td className="text-right py-1 px-2 text-ocean-150">{cl.dominantPercent}%</td>
                          <td className="text-center py-1 pl-2">
                            {cl.hasConflict
                              ? <span className="text-orange-600">diverge</span>
                              : <span className="text-emerald-600">ok</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rule.ncmClusters.length > 20 && (
                    <p className="text-xs text-ocean-60 mt-1">+ {rule.ncmClusters.length - 20} NCMs ocultos</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Evidencia */}
          {hasEvidence && (
            <div>
              <button
                onClick={() => setEvidenceExpanded(!evidenceExpanded)}
                className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-1"
              >
                <BarChart3 className="w-3 h-3" />
                {evidenceExpanded ? 'Ocultar evidencia' : 'Ver evidencia'}
              </button>
              {evidenceExpanded && (
                <div className="mt-1 text-xs text-ocean-150 space-y-0.5 bg-ocean-10 rounded p-2">
                  <p>{rule.evidence.itemCount} itens | {rule.evidence.uniqueSuppliers} fornecedores</p>
                  {rule.evidence.firstSeen && (
                    <p>Periodo: {rule.evidence.firstSeen} a {rule.evidence.lastSeen}</p>
                  )}
                  {rule.evidence.sampleDocs && rule.evidence.sampleDocs.length > 0 && (
                    <p>Docs exemplo: {rule.evidence.sampleDocs.slice(0, 5).join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Campos editaveis da regra */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-ocean-60 mb-0.5">Regime Emissor</label>
              <select
                value={rule.regimeEmissor}
                onChange={(e) => onUpdateRule('regimeEmissor', e.target.value)}
                className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
              >
                <option value="">(sem regime)</option>
                {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-ocean-60 mb-0.5">Regime Destinatario</label>
              <select
                value={rule.regimeDestinatario}
                onChange={(e) => onUpdateRule('regimeDestinatario', e.target.value)}
                className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
              >
                {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {/* NCM (se excecao) */}
          {rule.ncm && (
            <div>
              <label className="block text-xs text-ocean-60 mb-0.5">NCM (Codigo do Item)</label>
              <input
                type="text"
                value={rule.ncm}
                onChange={(e) => onUpdateRule('ncm', e.target.value)}
                className="w-full px-2 py-1 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
              />
            </div>
          )}

          {/* Tabela de determinacoes */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-ocean-150">Impostos</p>
              <button
                onClick={onAddDet}
                className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" />
                Adicionar
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-ocean-10">
                    <th className="text-left px-2 py-1 text-ocean-150 font-medium">Imposto</th>
                    <th className="text-left px-2 py-1 text-ocean-150 font-medium">Aliq %</th>
                    {hasReformData && (
                      <th className="text-left px-2 py-1 text-ocean-150 font-medium">cClassTrib</th>
                    )}
                    <th className="text-left px-2 py-1 text-ocean-150 font-medium">CST/Tipo Parametro</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {dets.map((det, i) => (
                    <tr key={det.externalId} className="border-t border-ocean-30">
                      <td className="px-2 py-1">
                        <select
                          value={det.codigoImposto}
                          onChange={(e) => onUpdateDet(det.externalId, 'codigoImposto', e.target.value)}
                          className="w-full px-1 py-0.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                        >
                          {TAX_CODES.map(tc => (
                            <option key={tc.id} value={tc.id}>{tc.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          step="0.01"
                          value={det.aliquota}
                          onChange={(e) => onUpdateDet(det.externalId, 'aliquota', parseFloat(e.target.value) || 0)}
                          className="w-16 px-1 py-0.5 border border-ocean-30 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-ocean-120"
                        />
                      </td>
                      {hasReformData && (
                        <td className="px-2 py-1">
                          <span className="text-xs text-ocean-100">{det.cClassTrib || ''}</span>
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <select
                          value={det.tipoParametro}
                          onChange={(e) => onUpdateDet(det.externalId, 'tipoParametro', e.target.value)}
                          className="w-full px-1 py-0.5 border border-ocean-30 rounded text-xs focus:outline-none focus:ring-1 focus:ring-ocean-120"
                        >
                          <option value="">(nenhum)</option>
                          {paramTypeOptions.map(pt => (
                            <option key={pt} value={pt}>{pt}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1">
                        <button
                          onClick={() => onRemoveDet(det.externalId)}
                          className="text-ocean-60 hover:text-rose"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* M4: Alertas inline (linguagem leiga, mesma fonte do Studio) */}
          <RuleAlertCards rule={rule} dets={dets} />

          {/* M2: Rodape-guia */}
          <div className="bg-slate-50 border border-slate-200 text-slate-500 text-xs p-2 rounded mt-3 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>O sistema nao cria regras automaticamente. Ele mostra como as notas foram tributadas para ajudar o consultor a definir a regra correta.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Review Panel ───────────────────────────────────────────────────────

function AIReviewPanel({ aiAnalysis, analyzing, analyzeError, onApplyPatch }) {
  const [expandedSection, setExpandedSection] = useState(null);
  const [appliedPatches, setAppliedPatches] = useState(new Set());

  if (!analyzing && !aiAnalysis && !analyzeError) return null;

  const errors = aiAnalysis?.constraintErrors?.filter(e => e.severity === 'error') || [];
  const warnings = aiAnalysis?.constraintErrors?.filter(e => e.severity === 'warning') || [];
  const autoApplies = aiAnalysis?.autoApplies || [];
  const aiIssues = aiAnalysis?.aiIssues || [];
  const aiPatches = aiAnalysis?.aiPatches || [];

  function handleApply(patch) {
    onApplyPatch(patch);
    setAppliedPatches(prev => new Set([...prev, patch.id]));
  }

  const severityIcon = {
    error: <AlertCircle className="w-3.5 h-3.5 text-rose" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
    info: <Info className="w-3.5 h-3.5 text-blue-500" />,
  };

  return (
    <div className="border border-ocean-30 rounded-lg overflow-hidden">
      <div className="bg-ocean-10 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-ocean-150" />
          <span className="text-sm font-medium text-ocean-180">Analise de Consistencia</span>
        </div>
        {analyzing && (
          <span className="flex items-center gap-1 text-xs text-ocean-100">
            <Loader2 className="w-3 h-3 animate-spin" />
            Analisando...
          </span>
        )}
        {aiAnalysis?.fromCache && (
          <span className="text-xs text-ocean-60">(cache)</span>
        )}
        {aiAnalysis?.skippedAI && (
          <span className="text-xs text-ocean-60">
            {aiAnalysis.skippedAI === 'below_threshold' ? '(dataset pequeno — sem IA)' : '(sem API key)'}
          </span>
        )}
      </div>

      {analyzeError && (
        <div className="px-3 py-2 bg-rose/10 text-xs text-rose">
          Erro na analise: {analyzeError}
        </div>
      )}

      {aiAnalysis && (
        <div className="divide-y divide-ocean-20">
          {/* Auto-applies */}
          {autoApplies.length > 0 && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'auto' ? null : 'auto')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs hover:bg-ocean-5"
              >
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-pine" />
                  <span className="font-medium text-ocean-150">{autoApplies.length} correcoes automaticas</span>
                </span>
                {expandedSection === 'auto' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {expandedSection === 'auto' && (
                <div className="px-3 pb-2 space-y-1">
                  {autoApplies.map((a, i) => (
                    <div key={i} className="text-xs text-ocean-150 bg-pine/5 rounded px-2 py-1">
                      <span className="font-mono text-ocean-100">{a.field}</span>: {a.oldValue ?? 'null'} → <span className="font-medium text-pine">{a.newValue}</span>
                      <p className="text-ocean-60 mt-0.5">{a.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Constraint errors */}
          {errors.length > 0 && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'errors' ? null : 'errors')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs hover:bg-ocean-5"
              >
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose" />
                  <span className="font-medium text-rose">{errors.length} erros de constraint</span>
                </span>
                {expandedSection === 'errors' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {expandedSection === 'errors' && (
                <div className="px-3 pb-2 space-y-1 max-h-48 overflow-y-auto">
                  {errors.map((e, i) => (
                    <div key={i} className="text-xs bg-rose/5 rounded px-2 py-1">
                      <span className="font-mono text-ocean-100">{e.field}</span>: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Issues */}
          {aiIssues.length > 0 && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'issues' ? null : 'issues')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs hover:bg-ocean-5"
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-medium text-ocean-150">{aiIssues.length} observacoes da IA</span>
                </span>
                {expandedSection === 'issues' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {expandedSection === 'issues' && (
                <div className="px-3 pb-2 space-y-1 max-h-48 overflow-y-auto">
                  {aiIssues.map((issue, i) => (
                    <div key={issue.id || i} className="text-xs rounded px-2 py-1 bg-amber-50/50">
                      <div className="flex items-center gap-1">
                        {severityIcon[issue.severity]}
                        <span className="font-medium">{issue.message}</span>
                      </div>
                      {issue.evidence && (
                        <p className="text-ocean-60 mt-0.5 pl-4">
                          {issue.evidence.itemCount && `${issue.evidence.itemCount} itens`}
                          {issue.evidence.distribution && ` — ${JSON.stringify(issue.evidence.distribution)}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Patches */}
          {aiPatches.length > 0 && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'patches' ? null : 'patches')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs hover:bg-ocean-5"
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-500" />
                  <span className="font-medium text-ocean-150">{aiPatches.length} sugestoes de correcao</span>
                </span>
                {expandedSection === 'patches' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {expandedSection === 'patches' && (
                <div className="px-3 pb-2 space-y-1.5 max-h-64 overflow-y-auto">
                  {aiPatches.map((patch) => (
                    <div key={patch.id} className="text-xs border border-blue-100 rounded px-2 py-1.5 bg-blue-50/30">
                      <div className="flex items-center justify-between">
                        <span>
                          <span className="font-mono text-ocean-100">{patch.field}</span>:
                          <span className="text-ocean-60 line-through ml-1">{patch.currentValue || 'null'}</span>
                          <span className="ml-1">→</span>
                          <span className="font-medium text-blue-700 ml-1">{patch.selectedValue}</span>
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1 py-0.5 rounded text-[10px] ${
                            patch.risk === 'high' ? 'bg-rose/10 text-rose' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {patch.risk}
                          </span>
                          {appliedPatches.has(patch.id) ? (
                            <span className="text-pine font-medium">Aplicado</span>
                          ) : (
                            <button
                              onClick={() => handleApply(patch)}
                              className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Aplicar
                            </button>
                          )}
                        </div>
                      </div>
                      {patch.evidence?.reason && (
                        <p className="text-ocean-60 mt-1">{patch.evidence.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Warnings from pre-validator */}
          {warnings.length > 0 && (
            <div>
              <button
                onClick={() => setExpandedSection(expandedSection === 'warnings' ? null : 'warnings')}
                className="w-full px-3 py-2 flex items-center justify-between text-xs hover:bg-ocean-5"
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-medium text-ocean-150">{warnings.length} avisos</span>
                </span>
                {expandedSection === 'warnings' ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {expandedSection === 'warnings' && (
                <div className="px-3 pb-2 space-y-1 max-h-48 overflow-y-auto">
                  {warnings.map((w, i) => (
                    <div key={i} className="text-xs bg-amber-50/50 rounded px-2 py-1">
                      <span className="font-mono text-ocean-100">{w.field}</span>: {w.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RuleAlertCards — alertas inline para RuleCard ────────────────────────────

function RuleAlertCards({ rule, dets }) {
  const alerts = buildRuleAlerts(rule, dets);
  const [showAll, setShowAll] = useState(false);

  if (alerts.length === 0) return null;

  const visible = showAll ? alerts : alerts.slice(0, 3);
  const hidden = alerts.length - 3;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ocean-150 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 text-amber-500" />
        Alertas desta regra ({alerts.length})
      </p>
      {visible.map((alert, i) => {
        const w = translateWarning(alert.reason, alert.meta);
        return <AlertCard key={i} warning={w} />;
      })}
      {!showAll && hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-ocean-120 hover:text-ocean-180"
        >+ {hidden} alerta(s) oculto(s)</button>
      )}
    </div>
  );
}

function AlertCard({ warning }) {
  const [expanded, setExpanded] = useState(false);

  const sevColor = warning.severity === 'ERROR'
    ? 'border-rose bg-red-50'
    : warning.severity === 'WARN'
      ? 'border-amber-300 bg-amber-50'
      : 'border-blue-200 bg-blue-50';

  const sevText = warning.severity === 'ERROR'
    ? 'text-red-700'
    : warning.severity === 'WARN'
      ? 'text-amber-700'
      : 'text-blue-700';

  return (
    <div className={`rounded border ${sevColor} p-2`}>
      <p className={`text-xs font-medium ${sevText}`}>{warning.title}</p>
      {warning.happened && (
        <p className="text-xs text-ocean-150 mt-0.5">{warning.happened}</p>
      )}
      {(warning.impact || warning.action) && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-ocean-120 hover:text-ocean-180 mt-0.5"
          >{expanded ? 'Menos' : 'O que fazer?'}</button>
          {expanded && (
            <div className="text-xs text-ocean-100 mt-1 space-y-0.5">
              {warning.impact && <p><span className="font-medium">Impacto:</span> {warning.impact}</p>}
              {warning.action && <p><span className="font-medium">Acao:</span> {warning.action}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StepReview({ rules, setRules, determinations, setDeterminations, items, setItems, stats, onBack, onExport, paramTypeOptions, aiAnalysis, analyzing, analyzeError, onApplyPatch, aiEnabled, onToggleAi, onRunAnalysis, hasApiKey, needsReview, source, originalFiles, config }) {
  const [rawViewerOpen, setRawViewerOpen] = useState(false);
  function updateRule(ruleExtId, field, value) {
    setRules(prev => prev.map(r =>
      r.externalId === ruleExtId ? { ...r, [field]: value } : r
    ));
  }

  function removeRule(ruleExtId) {
    setRules(prev => prev.filter(r => r.externalId !== ruleExtId));
    setDeterminations(prev => prev.filter(d => d.ruleExternalId !== ruleExtId));
  }

  function updateDet(detExtId, field, value) {
    setDeterminations(prev => prev.map(d =>
      d.externalId === detExtId ? { ...d, [field]: value } : d
    ));
  }

  function removeDet(detExtId) {
    setDeterminations(prev => prev.filter(d => d.externalId !== detExtId));
  }

  function addDet(ruleExtId) {
    setDeterminations(prev => [...prev, {
      externalId: Date.now(),
      ruleExternalId: ruleExtId,
      aliquota: 0,
      validoAPartirDe: '',
      validoAte: '',
      codigoImposto: 'ICMS_BR',
      tipoParametro: '',
      valorParametro: '',
      valorAbatimento: '',
      _taxType: '',
      _cst: '',
      cClassTrib: '',
    }]);
  }

  // (unused old list view variables removed)

  return (
    <div className="space-y-4">
      {/* Raw File Viewer toggle */}
      {originalFiles && originalFiles.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => setRawViewerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-ocean-120 hover:text-ocean-180 border border-ocean-30 rounded-md hover:border-ocean-60 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Arquivo Original
          </button>
        </div>
      )}

      <RawFileViewer
        files={originalFiles || []}
        isOpen={rawViewerOpen}
        onClose={() => setRawViewerOpen(false)}
      />

      <InvoiceExplorer
          items={items}
          setItems={setItems}
          rules={rules}
          setRules={setRules}
          determinations={determinations}
          setDeterminations={setDeterminations}
          paramTypeOptions={paramTypeOptions}
          config={config}
        />

      {/* Old list view removed — InvoiceExplorer replaces it */}

      {/* Botoes — always visible */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-ocean-30 text-ocean-150 rounded-md text-sm font-medium hover:bg-ocean-10"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <button
          onClick={onExport}
          disabled={rules.length === 0}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowRight className="w-4 h-4" />
          Exportar
        </button>
      </div>
    </div>
  );
}

// ── Etapa 3: Export ─────────────────────────────────────────────────────────

const REFORM_CODES = new Set(['CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR']);

function isValidCClassTribUI(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^0+$/.test(s)) return false;
  return true;
}

function StepExport({ rules, determinations, stats, onBack, lookupsStatus, reformReadiness }) {
  const [exported, setExported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [allowIncomplete, setAllowIncomplete] = useState(false);

  const hasReformData = determinations.some(d =>
    (d.cClassTrib && isValidCClassTribUI(d.cClassTrib)) ||
    REFORM_CODES.has(d.codigoImposto)
  );

  // Determinacoes com tipoParametro nao resolvido (flag explicita do generator)
  const unresolvedDets = determinations.filter(d => d._unresolvedParam === true);
  const hasUnresolvedParams = unresolvedDets.length > 0;

  // Agrupar por _unresolvedReason para mensagens claras
  const unresolvedByReason = unresolvedDets.reduce((acc, d) => {
    const reason = d._unresolvedReason || 'unknown';
    if (!acc[reason]) acc[reason] = { count: 0, taxes: new Map(), hasSuggestion: false };
    acc[reason].count++;
    const taxKey = d.codigoImposto || 'unknown';
    if (!acc[reason].taxes.has(taxKey)) acc[reason].taxes.set(taxKey, { count: 0, suggestions: new Set() });
    const taxInfo = acc[reason].taxes.get(taxKey);
    taxInfo.count++;
    if (d._suggestedParam) { taxInfo.suggestions.add(d._suggestedParam); acc[reason].hasSuggestion = true; }
    return acc;
  }, {});

  // Dets sem sugestao nenhuma (tipoParametro vazio) — RESTlet nao pode resolver
  const emptyParamCount = unresolvedDets.filter(d => !d.tipoParametro).length;
  // Dets com sugestao — RESTlet pode tentar 3-step
  const withSuggestionCount = unresolvedDets.filter(d => d.tipoParametro).length;

  function handleExportXLSX() {
    downloadXLSX(rules, determinations, stats);
    setExported(true);
  }

  function handleExportCSV() {
    downloadCSVs(rules, determinations);
    setExported(true);
  }

  async function handleImportNetSuite() {
    setImporting(true);
    setImportResult(null);

    try {
      // Preparar dados para envio — remover campos internos (prefixo _)
      const cleanRules = rules.map(r => ({
        externalId: r.externalId,
        name: r.name,
        parent: r.parent || '',
        subsidiary: r.subsidiary,
        cfop: r.cfop,
        ncm: r.ncm || '',
        ufEmissor: r.ufEmissor,
        ufDestinatario: r.ufDestinatario,
        cidadeEmissor: r.cidadeEmissor || '',
        cidadeDestinatario: r.cidadeDestinatario || '',
        paisEmissor: r.paisEmissor || 'BR',
        paisDestinatario: r.paisDestinatario || 'BR',
        regimeEmissor: r.regimeEmissor,
        regimeDestinatario: r.regimeDestinatario,
        lobEmissor: r.lobEmissor,
        lobDestinatario: r.lobDestinatario,
        validoAPartirDe: r.validoAPartirDe || '',
        validoAte: r.validoAte || '',
      }));

      // Se allowIncomplete, pular APENAS dets sem sugestao (tipoParametro vazio)
      // Dets com sugestao sao enviadas — RESTlet tenta 3-step (contextual → SuiteQL → cClassTrib)
      const detsToSend = allowIncomplete
        ? determinations.filter(d => !(d._unresolvedParam && !d.tipoParametro))
        : determinations;

      const cleanDets = detsToSend.map(d => ({
        externalId: d.externalId,
        ruleExternalId: d.ruleExternalId,
        codigoImposto: d.codigoImposto,
        aliquota: d.aliquota,
        tipoParametro: d.tipoParametro || '',
        valorParametro: d.valorParametro || '',
        valorAbatimento: d.valorAbatimento || '',
        validoAPartirDe: d.validoAPartirDe || '',
        validoAte: d.validoAte || '',
        cClassTrib: d.cClassTrib || '',
        natBcCred: d.natBcCred || '',
      }));

      const result = await sendToBackground({
        type: 'CREATE_TAX_RULES',
        data: { rules: cleanRules, determinations: cleanDets },
      });

      setImportResult(result);
    } catch (err) {
      setImportResult({ success: false, errors: [{ type: 'general', error: err.message }] });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-ocean-120" />
          <h3 className="text-sm font-medium text-ocean-180">Resumo da Exportacao</h3>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-ocean-150">
            <span>Regras de Impostos</span>
            <span className="font-medium text-ocean-180">{rules.length}</span>
          </div>
          <div className="flex justify-between text-ocean-150">
            <span>Determinacoes</span>
            <span className="font-medium text-ocean-180">{determinations.length}</span>
          </div>
          <div className="flex justify-between text-ocean-150">
            <span>Regras genericas</span>
            <span className="font-medium text-ocean-180">{rules.filter(r => !r._isException).length}</span>
          </div>
          <div className="flex justify-between text-ocean-150">
            <span>Excecoes por NCM</span>
            <span className="font-medium text-golden">{rules.filter(r => r._isException).length}</span>
          </div>
        </div>
      </div>

      {/* Avisos CBS/IBS contextuais */}
      {hasReformData && lookupsStatus !== 'ready' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">Lookups do NetSuite nao carregaram</p>
          <p className="mt-1">
            Param Types CBS/IBS podem estar com nomes incompletos.
            Volte a tela de upload e aguarde o carregamento antes de reprocessar.
          </p>
        </div>
      )}

      {hasReformData && lookupsStatus === 'ready' && reformReadiness && (reformReadiness.cClassTribParamTypes || []).length === 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-medium">Ambiente sem Param Types de reforma (cClassTrib)</p>
          <p className="mt-1">
            Nenhum param type cClassTrib encontrado na tabela CUSTOMRECORD_FTE_PARAMTYPE.
            Determinacoes CBS/IBS serao ignoradas na importacao.
          </p>
        </div>
      )}

      {hasReformData && lookupsStatus === 'ready' && hasUnresolvedParams && (reformReadiness?.cClassTribParamTypes || []).length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">Alguns Param Types CBS/IBS nao foram reconhecidos</p>
          <p className="mt-1">
            Verifique se os codigos cClassTrib das determinacoes existem no ambiente NetSuite.
          </p>
        </div>
      )}

      {/* Banner: determinacoes nao resolvidas */}
      {hasUnresolvedParams && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <AlertTriangle className="w-4 h-4" />
            {unresolvedDets.length} determinacao(es) sem tipo de parametro resolvido
          </div>
          <div className="text-xs text-amber-700 space-y-2">
            {unresolvedByReason.no_param_types_loaded && (
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>
                  <strong>{unresolvedByReason.no_param_types_loaded.count}</strong> det(s) nao validadas — dados FTE do NetSuite nao carregaram.
                  Volte e aguarde o carregamento dos Param Types.
                </span>
              </div>
            )}
            {unresolvedByReason.no_env_match && (
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>
                  <strong>{unresolvedByReason.no_env_match.count}</strong> det(s) com sugestao nao encontrada no ambiente.
                  Verifique CUSTOMRECORD_FTE_PARAMTYPE.
                </span>
              </div>
            )}
            {unresolvedByReason.no_suggestion && (
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                <span>
                  <strong>{unresolvedByReason.no_suggestion.count}</strong> det(s) sem mapeamento CST → ParamType.
                  Requer selecao manual.
                </span>
              </div>
            )}
          </div>
          {withSuggestionCount > 0 && (
            <p className="text-xs text-amber-600">
              {withSuggestionCount} det(s) com sugestao serao enviadas ao RESTlet (tentativa 3-step).
              {emptyParamCount > 0 && ` ${emptyParamCount} det(s) sem sugestao serao puladas.`}
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-amber-800 pt-1 border-t border-amber-200">
            <input
              type="checkbox"
              checked={allowIncomplete}
              onChange={(e) => setAllowIncomplete(e.target.checked)}
              className="rounded border-amber-400"
            />
            Criar mesmo assim{emptyParamCount > 0 ? ` — ${emptyParamCount} det(s) sem sugestao serao puladas` : ''}
          </label>
        </div>
      )}

      {/* Importar para NetSuite */}
      <div className="space-y-2">
        <button
          onClick={handleImportNetSuite}
          disabled={importing || rules.length === 0 || (hasUnresolvedParams && !allowIncomplete)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-pine text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {importing
            ? `Importando ${rules.length} regras + ${(allowIncomplete ? determinations.length - emptyParamCount : determinations.length)} determinacoes...`
            : hasUnresolvedParams && !allowIncomplete
              ? 'Corrija as determinacoes antes de importar'
              : 'Importar para NetSuite'
          }
        </button>
      </div>

      {/* Resultado da importacao */}
      {importResult && (() => {
        const hasErrors = importResult.errors && importResult.errors.length > 0;
        const hasCreated = (importResult.rulesCreated || 0) > 0 || (importResult.determinationsCreated || 0) > 0;
        const isPartial = hasErrors && hasCreated;
        const isFullSuccess = importResult.success && !hasErrors;

        const bgClass = isFullSuccess
          ? 'bg-green-50 border-green-200'
          : isPartial
            ? 'bg-amber-50 border-amber-200'
            : 'bg-red-50 border-red-200';

        return (
          <div className={`rounded-lg border p-3 space-y-2 ${bgClass}`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              {isFullSuccess ? (
                <>
                  <CheckCircle className="w-4 h-4 text-pine" />
                  <span className="text-pine">Importado com sucesso!</span>
                </>
              ) : isPartial ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-amber-700">Importacao parcial — {importResult.errors.length} erro(s)</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-rose" />
                  <span className="text-rose">Importacao com erros</span>
                </>
              )}
            </div>

            <div className="text-xs space-y-0.5">
              {importResult.rulesCreated !== undefined && (
                <p className="text-ocean-150">Regras criadas: <span className="font-medium">{importResult.rulesCreated}</span></p>
              )}
              {importResult.determinationsCreated !== undefined && (
                <p className="text-ocean-150">Determinacoes criadas: <span className="font-medium">{importResult.determinationsCreated}</span></p>
              )}
              {allowIncomplete && unresolvedDets.length > 0 && (
                <p className="text-amber-600">Determinacoes puladas (sem tipoParametro): <span className="font-medium">{unresolvedDets.length}</span></p>
              )}
            </div>

            {hasErrors && (
              <div className="space-y-1 mt-1">
                <p className="text-xs font-medium text-rose">Erros ({importResult.errors.length}):</p>
                {importResult.errors.slice(0, 10).map((err, i) => (
                  <p key={i} className="text-xs text-red-600">
                    [{err.type || 'geral'}] {err.externalId ? `#${err.externalId}: ` : ''}{err.error}
                  </p>
                ))}
                {importResult.errors.length > 10 && (
                  <p className="text-xs text-red-400">... e mais {importResult.errors.length - 10} erro(s)</p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Separador */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-ocean-30" />
        <span className="text-xs text-ocean-60">ou exporte arquivo</span>
        <div className="flex-1 h-px bg-ocean-30" />
      </div>

      {/* Botoes de export arquivo */}
      <div className="space-y-2">
        <button
          onClick={handleExportXLSX}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150"
        >
          <Download className="w-4 h-4" />
          Exportar XLSX (Template 160)
        </button>

        <button
          onClick={handleExportCSV}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-ocean-30 text-ocean-150 rounded-md text-sm font-medium hover:bg-ocean-10"
        >
          <FileText className="w-4 h-4" />
          Exportar CSVs separados
        </button>
      </div>

      {exported && (
        <div className="flex items-center gap-2 text-pine text-sm">
          <CheckCircle className="w-4 h-4" />
          <span>Arquivo exportado com sucesso!</span>
        </div>
      )}

      <button
        onClick={onBack}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-ocean-30 text-ocean-150 rounded-md text-sm font-medium hover:bg-ocean-10"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para revisao
      </button>
    </div>
  );
}

// ── Pagina principal ────────────────────────────────────────────────────────

export default function TaxRules() {
  const navigate = useNavigate();
  const [step, setStep] = useState('upload'); // 'upload' | 'review' | 'export'
  const [source, setSource] = useState('xml'); // 'xml' | 'sped'

  // Subsidiarias do NetSuite
  const [subsidiaries, setSubsidiaries] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);

  // Param types reais do NetSuite (para match exato na importacao)
  const [nsParamTypes, setNsParamTypes] = useState([]);
  const [reformReadiness, setReformReadiness] = useState(null);
  const [lookupsStatus, setLookupsStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [lookupsError, setLookupsError] = useState(null);

  useEffect(() => {
    async function fetchLookups() {
      setSubsLoading(true);
      setLookupsStatus('loading');
      setLookupsError(null);
      try {
        const data = await sendToBackground({ type: 'FETCH_LOOKUP_DATA' });
        if (data && data.subsidiaries && data.subsidiaries.length > 0) {
          setSubsidiaries(data.subsidiaries);
        }
      } catch {
        // Sem conexao com NetSuite — campo fica como input texto
      } finally {
        setSubsLoading(false);
      }

      // Buscar param types reais do FTE
      try {
        const fteData = await sendToBackground({ type: 'TAX_DISCOVERY', action: 'taxDiscoveryFTE' });
        if (fteData && fteData.paramTypes && fteData.paramTypes.length > 0) {
          setNsParamTypes(fteData.paramTypes);
        }
        if (fteData && fteData.reformReadiness) {
          setReformReadiness(fteData.reformReadiness);
        }
        setLookupsStatus('ready');
      } catch (err) {
        setLookupsStatus('error');
        setLookupsError(err.message || 'Falha ao carregar dados FTE do NetSuite');
      }
    }
    fetchLookups();
  }, []);

  // Upload state
  const [files, setFiles] = useState([]);
  const [config, setConfig] = useState({
    subsidiaryName: '',
    subsidiaryCnpj: '',
    regimeEmissor: 'Lucro Real',
    regimeDestinatario: 'Lucro Real',
    lobEmissor: '',
    lobDestinatario: 'Venda de Mercadorias',
    validoAPartirDe: new Date().toISOString().slice(0, 10),
  });
  const [spedOptions, setSpedOptions] = useState({
    includeComplementary: false,
    includeSpecialRegime: false,
    requireNcm: false,
    useNcmNetSuite: false,
  });
  const [processing, setProcessing] = useState(false);
  const [parseErrors, setParseErrors] = useState([]);

  // XML progress & cancel
  const [xmlProgress, setXmlProgress] = useState(null);
  const [processingPhase, setProcessingPhase] = useState(null); // 'parsing' | 'generating' | null
  const cancelRef = useRef(false);

  // SPED progress & summary
  const [spedProgress, setSpedProgress] = useState(null);
  const [spedSummary, setSpedSummary] = useState(null);
  const eventSourceRef = useRef(null);

  // SPED quality gate
  const [qualityGateOpen, setQualityGateOpen] = useState(false);

  // needs_review from SPED processing
  const [needsReview, setNeedsReview] = useState(null); // { needsReview: [], needsReviewByReason: {} }

  // Original files for raw viewer
  const [originalFiles, setOriginalFiles] = useState([]); // [{ name, content }]

  // Rules state
  const [rules, setRules] = useState([]);
  const [determinations, setDeterminations] = useState([]);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);

  // AI Reviewer state
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  // AI toggle — persistido em localStorage, default inteligente
  const [aiEnabled, setAiEnabled] = useState(() => {
    const saved = localStorage.getItem('taxRulesAiEnabled');
    if (saved !== null) return saved === 'true';
    return false; // default false, sera recalculado quando rules + credentials carregarem
  });
  const [hasApiKey, setHasApiKey] = useState(false);

  // Verificar se Claude API key existe
  useEffect(() => {
    async function checkApiKey() {
      try {
        const creds = await sendToBackground({ type: 'GET_CREDENTIALS' });
        const hasKey = !!(creds && creds.claudeApiKey);
        setHasApiKey(hasKey);
        // Smart default: ativar se tem key e nao ha preferencia salva
        const saved = localStorage.getItem('taxRulesAiEnabled');
        if (saved === null && hasKey) {
          setAiEnabled(true);
        }
      } catch {
        setHasApiKey(false);
      }
    }
    checkApiKey();
  }, []);

  function toggleAiEnabled() {
    setAiEnabled(prev => {
      const next = !prev;
      localStorage.setItem('taxRulesAiEnabled', String(next));
      return next;
    });
  }

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  /**
   * Verifica se ha tributos da reforma nos resultados mas o ambiente nao esta pronto.
   * Retorna objeto reformNotReady para incluir em stats, ou null.
   */
  function checkReformNotReady(resultStats) {
    const rc = resultStats?.reformCounts;
    if (!rc || (rc.cbs === 0 && rc.ibs === 0 && rc.is === 0)) return null;
    if (!reformReadiness) return null; // discovery nao rodou — nao podemos afirmar

    const missingCodes = [];
    if (rc.cbs > 0 && !reformReadiness.cbsReady) missingCodes.push('CBS_2026_BR');
    if (rc.ibs > 0 && !reformReadiness.ibsReady) missingCodes.push('IBS_2026_BR');
    if (rc.is > 0 && !reformReadiness.isReady) missingCodes.push('IS_2026_BR');

    return missingCodes.length > 0 ? { missingCodes } : null;
  }

  async function handleAnalyze(currentRules, currentDets) {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await sendToBackground({
        type: 'ANALYZE_TAX_RULES',
        rules: currentRules,
        determinations: currentDets,
        config: {
          nsParamTypes: nsParamTypes.length > 0 ? nsParamTypes : null,
          regimeEmissor: config.regimeEmissor,
          regimeDestinatario: config.regimeDestinatario,
        },
      });

      // Se pre-validador corrigiu regras, atualizar state
      if (result.rules) setRules(result.rules);
      if (result.determinations) setDeterminations(result.determinations);

      setAiAnalysis({
        autoApplies: result.autoApplies || [],
        constraintErrors: result.constraintErrors || [],
        aiIssues: result.aiIssues || [],
        aiPatches: result.aiPatches || [],
        auditSummary: result.auditSummary || null,
        contextHash: result.contextHash || null,
        skippedAI: result.skippedAI || null,
        fromCache: result.fromCache || false,
      });
    } catch (err) {
      setAnalyzeError(err.message || 'Erro na analise IA');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleProcessXml() {
    setProcessing(true);
    setParseErrors([]);
    setXmlProgress(null);
    setProcessingPhase('parsing');
    cancelRef.current = false;

    try {
      // Save original file contents for Raw Viewer before parsing
      const origFiles = await Promise.all(
        files.map(f => new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: f.name, content: reader.result });
          reader.onerror = () => resolve({ name: f.name, content: '' });
          reader.readAsText(f);
        }))
      );
      setOriginalFiles(origFiles);

      const parsed = await parseNFeFiles(files, {
        onProgress: (current, total, fileName) => {
          setXmlProgress({ current, total, fileName });
        },
        shouldCancel: () => cancelRef.current,
      });

      if (parsed.cancelled) return;

      setParseErrors(parsed.errors);

      if (parsed.items.length === 0) {
        setParseErrors(prev => prev.length > 0
          ? prev
          : [{ fileName: 'Geral', errors: ['Nenhum item fiscal encontrado nos XMLs'] }]
        );
        return;
      }

      setProcessingPhase('generating');
      setXmlProgress(null);

      const result = generateTaxRules(parsed.items, {
        ...config,
        nsParamTypes: nsParamTypes.length > 0 ? nsParamTypes : null,
      });
      setItems(result.items || []);
      setRules([]);
      setDeterminations([]);
      setStats({ ...result.stats, ...parsed.stats });
      setStep('review');
      setAiAnalysis(null);
    } catch (err) {
      setParseErrors([{ fileName: 'Erro', errors: [err.message] }]);
    } finally {
      setProcessing(false);
      setProcessingPhase(null);
      setXmlProgress(null);
      cancelRef.current = false;
    }
  }

  function cancelXmlProcessing() {
    cancelRef.current = true;
  }

  async function handleProcessSped() {
    setProcessing(true);
    setParseErrors([]);
    setSpedProgress(null);
    setSpedSummary(null);
    setQualityGateOpen(false);

    try {
      // Upload files via FormData
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      formData.append('options', JSON.stringify({
        ...spedOptions,
        subsidiaryName: config.subsidiaryName,
        regimeDestinatario: config.regimeDestinatario,
        lobDestinatario: config.lobDestinatario,
        validoAPartirDe: config.validoAPartirDe,
        subsidiaryCnpj: config.subsidiaryCnpj,
        nsParamTypes: nsParamTypes.length > 0 ? nsParamTypes : null,
      }));

      const startResp = await fetch('/api/parse-sped/start', {
        method: 'POST',
        body: formData,
      });

      if (!startResp.ok) {
        const errData = await startResp.json();
        throw new Error(errData.error || 'Erro ao iniciar processamento');
      }

      const { jobId } = await startResp.json();

      // Connect SSE for progress
      await new Promise((resolve, reject) => {
        const es = new EventSource(`/api/parse-sped/events/${jobId}`);
        eventSourceRef.current = es;

        es.addEventListener('progress', (e) => {
          const data = JSON.parse(e.data);
          setSpedProgress(data);
        });

        es.addEventListener('done', (e) => {
          es.close();
          eventSourceRef.current = null;
          setSpedProgress(null);
          resolve();
        });

        es.addEventListener('error', (e) => {
          es.close();
          eventSourceRef.current = null;
          setSpedProgress(null);
          try {
            const data = JSON.parse(e.data);
            reject(new Error(data.message || 'Erro no processamento'));
          } catch {
            reject(new Error('Conexao com o servidor perdida'));
          }
        });

        es.onerror = () => {
          es.close();
          eventSourceRef.current = null;
          setSpedProgress(null);
          reject(new Error('Conexao com o servidor perdida'));
        };
      });

      // Fetch result
      const resultResp = await fetch(`/api/parse-sped/result/${jobId}`);
      if (!resultResp.ok) {
        const errData = await resultResp.json();
        throw new Error(errData.error || 'Erro ao obter resultado');
      }

      const result = await resultResp.json();

      setSpedSummary({
        rawStats: result.rawStats,
        qualityStats: result.qualityStats,
        companyInfo: result.companyInfo,
      });

      if (!result.items || result.items.length === 0) {
        setParseErrors([{ fileName: 'SPED', errors: ['Nenhum item fiscal encontrado. Verifique os arquivos e opcoes de filtro.'] }]);
        setProcessing(false);
        return;
      }

      setItems(result.items || []);
      setRules([]);
      setDeterminations([]);
      setStats({ ...result.stats });

      // needs_review data
      if (result.needsReview || result.stats?.needsReviewByReason) {
        setNeedsReview({
          items: result.needsReview || [],
          byReason: result.stats?.needsReviewByReason || {},
        });
      }

      // Exibir warnings do servidor (ex: REFORM_NO_LOOKUPS, COMPANY_INFO_CORRUPTED)
      if (result.warnings && result.warnings.length > 0) {
        setParseErrors(prev => [...prev, { fileName: 'Avisos', errors: result.warnings }]);
      }

      // Quality gate: bloquear se CST_ICMS ausente
      const qs = result.qualityStats;
      const hasBlockingQuality = (qs?.warningReasons?.noIcmsCst > 0);

      if (hasBlockingQuality) {
        setQualityGateOpen(true);
        // NAO avanca para review — quality gate intercepta
      } else {
        setStep('review');
      }
      setAiAnalysis(null);
    } catch (err) {
      setParseErrors([{ fileName: 'SPED', errors: [err.message] }]);
    } finally {
      setProcessing(false);
    }
  }

  function handleProcess() {
    if (source === 'sped') {
      handleProcessSped();
    } else {
      handleProcessXml();
    }
  }

  // Lista de opcoes para dropdown de param type
  const paramTypeOptions = nsParamTypes.length > 0
    ? nsParamTypes.map(pt => pt.name)
    : PARAM_TYPES;

  const stepLabels = {
    upload: source === 'sped' ? '1. Upload SPED' : '1. Upload XMLs',
    review: '2. Revisao',
    export: '3. Exportar',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-ocean-150" />
          <h2 className="text-base font-medium text-ocean-180">Regras Fiscais</h2>
        </div>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          Inicio
        </button>
      </div>

      {/* Source toggle */}
      {step === 'upload' && (
        <div className="flex rounded-lg border border-ocean-30 overflow-hidden">
          <button
            onClick={() => { setSource('xml'); setFiles([]); setParseErrors([]); setSpedSummary(null); }}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              source === 'xml'
                ? 'bg-ocean-120 text-white'
                : 'bg-white text-ocean-150 hover:bg-ocean-10'
            }`}
          >
            NF-e XML
          </button>
          <button
            onClick={() => { setSource('sped'); setFiles([]); setParseErrors([]); setSpedSummary(null); }}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              source === 'sped'
                ? 'bg-ocean-120 text-white'
                : 'bg-white text-ocean-150 hover:bg-ocean-10'
            }`}
          >
            SPED Fiscal
          </button>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-4">
        {Object.entries(stepLabels).map(([key, label], i) => (
          <React.Fragment key={key}>
            {i > 0 && <div className="flex-shrink-0 w-4 h-px bg-ocean-30" />}
            <span className={`text-xs px-2 py-1 rounded-full ${
              step === key
                ? 'bg-ocean-120 text-white'
                : Object.keys(stepLabels).indexOf(step) > i
                  ? 'bg-pine text-white'
                  : 'bg-ocean-10 text-ocean-60'
            }`}>
              {label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      {step === 'upload' && !qualityGateOpen && (
        <StepUpload
          source={source}
          files={files}
          setFiles={setFiles}
          config={config}
          setConfig={setConfig}
          spedOptions={spedOptions}
          setSpedOptions={setSpedOptions}
          onProcess={handleProcess}
          processing={processing}
          parseErrors={parseErrors}
          subsidiaries={subsidiaries}
          subsLoading={subsLoading}
          spedProgress={spedProgress}
          spedSummary={spedSummary}
          xmlProgress={xmlProgress}
          processingPhase={processingPhase}
          onCancelXml={cancelXmlProcessing}
          lookupsStatus={lookupsStatus}
          lookupsError={lookupsError}
        />
      )}

      {step === 'upload' && qualityGateOpen && (
        <SpedQualityGate
          qualityStats={spedSummary?.qualityStats}
          onAcknowledge={() => {
            setQualityGateOpen(false);
            setStep('review');
          }}
          onBack={() => {
            setQualityGateOpen(false);
          }}
        />
      )}

      {step === 'review' && (
        <StepReview
          rules={rules}
          setRules={setRules}
          determinations={determinations}
          setDeterminations={setDeterminations}
          items={items}
          setItems={setItems}
          stats={stats}
          onBack={() => setStep('upload')}
          onExport={() => setStep('export')}
          paramTypeOptions={paramTypeOptions}
          aiAnalysis={aiAnalysis}
          analyzing={analyzing}
          analyzeError={analyzeError}
          onApplyPatch={(patch) => {
            if (patch.determinationExternalId) {
              setDeterminations(prev => prev.map(d =>
                d.externalId === patch.determinationExternalId
                  ? { ...d, [patch.field]: patch.selectedValue }
                  : d
              ));
            } else {
              setRules(prev => prev.map(r =>
                r.externalId === patch.ruleExternalId
                  ? { ...r, [patch.field]: patch.selectedValue }
                  : r
              ));
            }
          }}
          aiEnabled={aiEnabled}
          onToggleAi={toggleAiEnabled}
          onRunAnalysis={() => handleAnalyze(rules, determinations)}
          hasApiKey={hasApiKey}
          needsReview={needsReview}
          source={source}
          originalFiles={originalFiles}
          config={config}
        />
      )}

      {step === 'export' && (
        <StepExport
          rules={rules}
          determinations={determinations}
          stats={stats}
          onBack={() => setStep('review')}
          lookupsStatus={lookupsStatus}
          reformReadiness={reformReadiness}
        />
      )}
    </div>
  );
}
