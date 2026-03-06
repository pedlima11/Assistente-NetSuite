import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, Loader2, AlertTriangle, DollarSign,
  Building2, Calendar, Search, Edit3, CheckCircle, XCircle,
} from 'lucide-react';
import FileUploader from '../components/FileUploader.jsx';
import { parseExcelFile } from '../../parsers/excel-parser.js';
import { extractBalances } from '../../services/balance-parser.js';
import { sendToBackground } from '../../utils/api-client.js';
import { fetchNetSuiteAccounts, suggestAccountMapping } from '../../services/journal-entry-creator.js';

/**
 * Badge de status do mapeamento
 */
function MatchBadge({ type }) {
  const { t } = useTranslation('balance');
  if (type === 'exact') return <span className="text-pine" title={t('tooltipExact')}>OK</span>;
  if (type === 'fuzzy') return <span className="text-golden" title={t('tooltipFuzzy')}>~</span>;
  return <span className="text-rose" title={t('tooltipNone')}>?</span>;
}

const fmtBRL = (v) =>
  v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

/**
 * Input de valor BRL — mostra formatado, edita como numero
 */
function BRLInput({ value, onChange, className }) {
  const { t } = useTranslation('balance');
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');

  if (editing) {
    return (
      <input
        type="number"
        autoFocus
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onChange(Number(raw) || 0);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        className={`w-20 text-right px-1 py-0.5 border border-ocean-120 rounded text-xs focus:outline-none ${className || ''}`}
        step="0.01"
        min="0"
      />
    );
  }

  return (
    <span
      onClick={() => { setRaw(value || ''); setEditing(true); }}
      className={`inline-block w-20 text-right px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-ocean-10 ${className || ''}`}
      title={t('clickToEdit')}
    >
      {fmtBRL(value)}
    </span>
  );
}

export default function BalanceUpload() {
  const navigate = useNavigate();
  const { t } = useTranslation('balance');

  // Upload state
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');

  // Parsed balances (raw from Claude)
  const [rawBalances, setRawBalances] = useState([]);
  const [referenceDate, setReferenceDate] = useState('');
  const [trandate, setTrandate] = useState('');

  // Subsidiary
  const [subsidiaries, setSubsidiaries] = useState([]);
  const [selectedSubId, setSelectedSubId] = useState('');
  const [loadingSubs, setLoadingSubs] = useState(true);

  // NetSuite accounts + mapped balances
  const [nsAccounts, setNsAccounts] = useState(null); // { list, map }
  const [mappedBalances, setMappedBalances] = useState([]); // balances com nsAccountId
  const [resolving, setResolving] = useState(false);

  // Load subsidiaries on mount
  useEffect(() => {
    async function loadSubs() {
      try {
        const data = await sendToBackground({ type: 'FETCH_LOOKUP_DATA' });
        if (data.subsidiaries) {
          setSubsidiaries(data.subsidiaries);
          if (data.subsidiaries.length > 0) {
            setSelectedSubId(data.subsidiaries[0].id);
          }
        }
      } catch (err) {
        setError('Erro ao carregar subsidiaries: ' + err.message);
      } finally {
        setLoadingSubs(false);
      }
    }
    loadSubs();
  }, []);

  // Process file — extract balances via Claude
  async function handleProcess() {
    if (!file) return;
    setProcessing(true);
    setError('');
    setRawBalances([]);
    setMappedBalances([]);
    setNsAccounts(null);

    try {
      setStep('parsing');
      const parsedData = await parseExcelFile(file);

      setStep('extracting');
      const result = await extractBalances(parsedData);

      setRawBalances(result.balances);
      if (result.referenceDate) {
        setReferenceDate(result.referenceDate);
        setTrandate(result.referenceDate);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
      setStep('');
    }
  }

  // Fetch NS accounts + suggest mapping
  async function handleMapAccounts() {
    if (!selectedSubId || rawBalances.length === 0) return;
    setResolving(true);
    setError('');

    try {
      const accounts = await fetchNetSuiteAccounts(selectedSubId);
      setNsAccounts(accounts);

      const mapped = suggestAccountMapping(rawBalances, accounts);
      setMappedBalances(mapped);
    } catch (err) {
      setError('Erro ao buscar contas: ' + err.message);
    } finally {
      setResolving(false);
    }
  }

  // User changes the NS account mapping for a row
  function handleNsAccountChange(index, nsAccountId) {
    const updated = [...mappedBalances];
    const acct = nsAccounts.list.find((a) => a.id === nsAccountId);
    updated[index] = {
      ...updated[index],
      nsAccountId: nsAccountId,
      nsAccountLabel: acct ? `${acct.number} - ${acct.name}` : '',
      matchType: nsAccountId ? 'manual' : 'none',
    };
    setMappedBalances(updated);
  }

  // User edits debit/credit
  function handleBalanceChange(index, field, value) {
    const updated = [...mappedBalances];
    updated[index] = { ...updated[index], [field]: Number(value) || 0 };
    setMappedBalances(updated);
  }

  // Navigate to creation
  function handleCreate() {
    const withMapping = mappedBalances.filter((b) => b.nsAccountId);
    if (!selectedSubId || withMapping.length === 0) return;

    sessionStorage.setItem('balanceData', JSON.stringify({
      mappedBalances: withMapping,
      unmappedCount: mappedBalances.length - withMapping.length,
      subsidiaryId: selectedSubId,
      trandate: trandate || referenceDate || new Date().toISOString().split('T')[0],
    }));
    navigate('/balance-status');
  }

  // Stats
  const totalDebit = (mappedBalances.length > 0 ? mappedBalances : rawBalances)
    .reduce((sum, b) => sum + (b.debit || 0), 0);
  const totalCredit = (mappedBalances.length > 0 ? mappedBalances : rawBalances)
    .reduce((sum, b) => sum + (b.credit || 0), 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;

  const mappedCount = mappedBalances.filter((b) => b.nsAccountId).length;
  const unmappedCount = mappedBalances.length - mappedCount;
  const exactCount = mappedBalances.filter((b) => b.matchType === 'exact').length;
  const fuzzyCount = mappedBalances.filter((b) => b.matchType === 'fuzzy').length;

  // Detail accounts for dropdown (exclude summary)
  const detailAccounts = nsAccounts
    ? nsAccounts.list.filter((a) => !a.isSummary).sort((a, b) => a.number.localeCompare(b.number))
    : [];

  const showBalances = rawBalances.length > 0;
  const showMapping = mappedBalances.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">{t('title')}</h2>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          {t('home')}
        </button>
      </div>

      {/* Subsidiary selector */}
      <div className="bg-white rounded-lg border border-ocean-30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-5 h-5 text-ocean-120" />
          <h3 className="text-sm font-medium text-ocean-180">{t('subsidiary')}</h3>
        </div>
        {loadingSubs ? (
          <div className="flex items-center gap-2 text-sm text-ocean-150">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('loading')}
          </div>
        ) : subsidiaries.length === 0 ? (
          <p className="text-sm text-rose">{t('noSubsidiary')}</p>
        ) : (
          <select
            value={selectedSubId}
            onChange={(e) => { setSelectedSubId(e.target.value); setNsAccounts(null); setMappedBalances([]); }}
            className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120"
          >
            {subsidiaries.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.id} - {sub.name || 'Subsidiary'}
              </option>
            ))}
          </select>
        )}
        <p className="text-xs text-ocean-60 mt-2">
          {t('accountsMustExist')}
        </p>
      </div>

      {/* File upload */}
      <FileUploader onFileSelected={setFile} />

      {processing && (
        <div className="flex items-center gap-2 text-sm text-ocean-120">
          <Loader2 className="w-4 h-4 animate-spin" />
          {step === 'parsing' && t('parsingExcel')}
          {step === 'extracting' && t('extractingBalances')}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-rose">{error}</p>
        </div>
      )}

      {/* Extract button */}
      {!showBalances && (
        <button
          onClick={handleProcess}
          disabled={!file || processing || !selectedSubId}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {processing ? t('processing') : t('extractBalances')}
        </button>
      )}

      {showBalances && (
        <>
          {/* Date picker */}
          <div className="bg-white rounded-lg border border-ocean-30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="w-5 h-5 text-ocean-120" />
              <h3 className="text-sm font-medium text-ocean-180">{t('transactionDate')}</h3>
            </div>
            <input
              type="date"
              value={trandate}
              onChange={(e) => setTrandate(e.target.value)}
              className="w-full px-3 py-2 border border-ocean-30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ocean-120"
            />
            {referenceDate && referenceDate !== trandate && (
              <p className="text-xs text-ocean-60 mt-1">{t('dateDetected', { date: referenceDate })}</p>
            )}
          </div>

          {/* Map accounts button (before mapping is done) */}
          {!showMapping && (
            <button
              onClick={handleMapAccounts}
              disabled={resolving || !selectedSubId}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {resolving ? t('fetchingAccounts') : t('mapAccounts', { count: rawBalances.length })}
            </button>
          )}

          {/* Mapping table */}
          {showMapping && (
            <div className="bg-white rounded-lg border border-ocean-30 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-ocean-120" />
                  <h3 className="text-sm font-medium text-ocean-180">
                    {t('mappingTitle', { count: mappedBalances.length })}
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-pine">{exactCount} {t('exact')}</span>
                  <span className="text-golden">{fuzzyCount} {t('suggested')}</span>
                  {unmappedCount > 0 && <span className="text-rose">{unmappedCount} {t('unmapped')}</span>}
                </div>
              </div>

              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="text-left text-ocean-150 border-b border-ocean-30/50">
                      <th className="pb-2 pr-1 w-5"></th>
                      <th className="pb-2 pr-1">{t('fileColumn')}</th>
                      <th className="pb-2 pr-1">{t('nsAccountColumn')}</th>
                      <th className="pb-2 pr-1 text-right">{t('debitColumn')}</th>
                      <th className="pb-2 text-right">{t('creditColumn')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappedBalances.map((b, i) => (
                      <tr
                        key={b.number + '-' + i}
                        className={`border-b border-ocean-30/50 hover:bg-ocean-10 ${!b.nsAccountId ? 'bg-red-50/30' : ''}`}
                      >
                        <td className="py-1.5 pr-1 text-center">
                          <MatchBadge type={b.matchType} />
                        </td>
                        <td className="py-1.5 pr-1">
                          <div className="font-mono text-ocean-150 text-xs">{b.number}</div>
                          <div className="text-ocean-60 truncate max-w-[100px]" title={b.name}>{b.name}</div>
                        </td>
                        <td className="py-1.5 pr-1">
                          <select
                            value={b.nsAccountId || ''}
                            onChange={(e) => handleNsAccountChange(i, e.target.value)}
                            className={`w-full text-xs border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ocean-120 ${
                              !b.nsAccountId ? 'border-red-300 bg-red-50' :
                              b.matchType === 'fuzzy' ? 'border-yellow-300 bg-yellow-50' :
                              'border-ocean-30'
                            }`}
                          >
                            <option value="">{t('selectPlaceholder')}</option>
                            {detailAccounts.map((acct) => (
                              <option key={acct.id} value={acct.id}>
                                {acct.number} - {acct.name}{acct.description ? ` (${acct.description})` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 pr-1 text-right">
                          <BRLInput
                            value={b.debit}
                            onChange={(v) => handleBalanceChange(i, 'debit', v)}
                          />
                        </td>
                        <td className="py-1.5 text-right">
                          <BRLInput
                            value={b.credit}
                            onChange={(v) => handleBalanceChange(i, 'credit', v)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ocean-120 font-medium text-ocean-180">
                      <td colSpan={3} className="py-2 pr-1">{t('total')}</td>
                      <td className="py-2 pr-1 text-right">{totalDebit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right">{totalCredit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Difference warning */}
              {Math.abs(difference) > 0.01 && (
                <div className="mt-2 flex items-center gap-2 text-xs text-golden bg-yellow-50 rounded p-2">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span>
                    {t('differenceWarning', { value: Math.abs(difference).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) })}
                  </span>
                </div>
              )}

              {/* Legend */}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-ocean-60">
                <span><span className="text-pine font-medium">OK</span> = {t('legendExact')}</span>
                <span><span className="text-golden font-medium">~</span> = {t('legendSuggestion')}</span>
                <span><span className="text-rose font-medium">?</span> = {t('legendNoMapping')}</span>
              </div>
            </div>
          )}

          {/* Create JE button */}
          {showMapping && (
            <button
              onClick={handleCreate}
              disabled={mappedCount === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-pine text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowRight className="w-4 h-4" />
              {t('setOpeningBalances', { count: mappedCount })}
              {unmappedCount > 0 && (
                <span className="text-xs opacity-75">({unmappedCount} {t('ignored')})</span>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
