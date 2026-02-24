import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import FileUploader from '../components/FileUploader.jsx';
import { parseExcelFile } from '../../parsers/excel-parser.js';
import { structureFinancialData } from '../../services/claude-parser.js';

const IMPORT_LABELS = {
  'plano-de-contas': 'Plano de Contas',
  'dre': 'DRE',
  'balanco': 'Balanco Patrimonial',
};

export default function Upload() {
  const navigate = useNavigate();
  const location = useLocation();
  const importType = location.state?.importType || 'balanco';
  const pageTitle = IMPORT_LABELS[importType] || 'Upload de Arquivo';

  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(''); // 'parsing' | 'structuring'
  const [error, setError] = useState('');

  async function handleProcess() {
    if (!file) return;

    setProcessing(true);
    setError('');

    try {
      // Step 1: Parse Excel no side panel (acesso ao File)
      setStep('parsing');
      const parsedData = await parseExcelFile(file);

      // Step 2: Enviar JSON para Claude API via service worker
      setStep('structuring');
      const structuredData = await structureFinancialData(parsedData);

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
    <div className="max-w-md mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ocean-180">{pageTitle}</h2>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-ocean-150 hover:text-ocean-180 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" />
          Inicio
        </button>
      </div>

      <FileUploader onFileSelected={setFile} />

      {processing && (
        <div className="flex items-center gap-2 text-sm text-ocean-120">
          <Loader2 className="w-4 h-4 animate-spin" />
          {step === 'parsing' && 'Extraindo dados do Excel...'}
          {step === 'structuring' && 'Estruturando dados com Claude AI...'}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-rose">{error}</p>
        </div>
      )}

      <button
        onClick={handleProcess}
        disabled={!file || processing}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-ocean-120 text-white rounded-md text-sm font-medium hover:bg-ocean-180 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
        {processing ? 'Processando...' : 'Processar Arquivo'}
      </button>
    </div>
  );
}
