import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ArrowRight, ArrowLeft, AlertTriangle } from 'lucide-react';
import FileUploader from '../components/FileUploader.jsx';
import { parseExcelFile } from '../../parsers/excel-parser.js';
import { structureFinancialData } from '../../services/claude-parser.js';

/**
 * Merge robusto de dois ParsedData — deduplicacao de headers e sheetNames
 * @param {import('../../parsers/excel-parser.js').ParsedData | null} a
 * @param {import('../../parsers/excel-parser.js').ParsedData | null} b
 * @returns {import('../../parsers/excel-parser.js').ParsedData}
 */
function mergeParseResults(a, b) {
  if (!a) return b;
  if (!b) return a;

  const headerSet = new Map();
  for (const h of [...(a.headers || []), ...(b.headers || [])]) {
    const key = JSON.stringify(h);
    if (!headerSet.has(key)) headerSet.set(key, h);
  }

  const sheetSet = new Set([...(a.sheetNames || []), ...(b.sheetNames || [])]);

  return {
    fileName: [a.fileName, b.fileName].filter(Boolean).join(' + '),
    fileType: 'plano_completo',
    headers: [...headerSet.values()],
    rows: [...(a.rows || []), ...(b.rows || [])],
    sheetNames: [...sheetSet],
  };
}

/**
 * Detecta contas duplicadas por codigo (padrao X.X.X) entre os rows mergeados
 * @param {Array[]} mergedRows
 * @returns {number} quantidade de codigos duplicados
 */
function checkDuplicateAccounts(mergedRows) {
  const seen = new Map();
  let dupeCount = 0;
  for (const row of mergedRows) {
    const code = String(row[0] || '').trim();
    if (/^\d+(\.\d+)*$/.test(code)) {
      if (seen.has(code)) dupeCount++;
      else seen.set(code, true);
    }
  }
  return dupeCount;
}

export default function Upload() {
  const { t } = useTranslation('upload');
  const navigate = useNavigate();
  const location = useLocation();
  const importType = location.state?.importType || 'balanco';
  const pageTitle = t(`importLabels.${importType}`, t('defaultTitle'));

  const [primaryFile, setPrimaryFile] = useState(null);
  const [secondaryFile, setSecondaryFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(''); // 'parsing' | 'structuring'
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');

  async function handleProcess() {
    if (!primaryFile && !secondaryFile) return;

    setProcessing(true);
    setError('');
    setDuplicateWarning('');

    try {
      // Step 1: Parse — fail-fast (Promise.all)
      setStep('parsing');
      const [parsed1, parsed2] = await Promise.all([
        primaryFile ? parseExcelFile(primaryFile) : null,
        secondaryFile ? parseExcelFile(secondaryFile) : null,
      ]);

      // Validar que pelo menos um retornou linhas uteis
      const rows1 = parsed1?.rows?.length || 0;
      const rows2 = parsed2?.rows?.length || 0;
      if (rows1 + rows2 === 0) {
        throw new Error(t('emptyFiles'));
      }

      // Merge
      const mergedData = mergeParseResults(parsed1, parsed2);

      // Checar duplicatas se dois arquivos foram fornecidos
      if (parsed1 && parsed2) {
        const dupeCount = checkDuplicateAccounts(mergedData.rows);
        if (dupeCount > 0) {
          setDuplicateWarning(t('duplicateWarning', { count: dupeCount }));
        }
      }

      // Step 2: Enviar JSON para Claude API via server
      setStep('structuring');
      const structuredData = await structureFinancialData(mergedData);

      // Salvar dados temporariamente e navegar para review
      sessionStorage.setItem('reviewData', JSON.stringify(structuredData));
      navigate('/review');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
      setStep('');
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">{pageTitle}</h2>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          {t('backHome')}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-ocean-150 mb-1">{t('primaryFileLabel')}</p>
          <FileUploader
            onFileSelected={setPrimaryFile}
            subtitle={t('primaryFileSubtitle')}
          />
        </div>

        <div>
          <p className="text-sm font-medium text-ocean-150 mb-1">{t('secondaryFileLabel')}</p>
          <FileUploader
            onFileSelected={setSecondaryFile}
            subtitle={t('secondaryFileSubtitle')}
          />
        </div>
      </div>

      {duplicateWarning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{duplicateWarning}</p>
        </div>
      )}

      {processing && (
        <div className="flex items-center gap-2 text-sm text-ocean-120">
          <Loader2 className="w-4 h-4 animate-spin" />
          {step === 'parsing' && t('parsing')}
          {step === 'structuring' && t('structuring')}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-rose">{error}</p>
        </div>
      )}

      <button
        onClick={handleProcess}
        disabled={(!primaryFile && !secondaryFile) || processing}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
        {processing ? t('processing') : t('processFiles')}
      </button>
    </div>
  );
}
