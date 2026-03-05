import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';

const ACCEPTED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

/**
 * Componente drag & drop para upload de arquivos Excel
 * @param {Object} props
 * @param {(file: File) => void} props.onFileSelected
 * @param {string} [props.accept] - Extensoes aceitas (ex: '.xlsx,.xls,.csv')
 * @param {string} [props.subtitle] - Texto secundario da drop zone
 */
export default function FileUploader({ onFileSelected, accept, subtitle }) {
  const effectiveAccept = accept || '.xlsx,.xls,.csv';
  const effectiveSubtitle = subtitle || 'Formatos aceitos: .xlsx, .xls, .csv';
  const effectiveExtensions = effectiveAccept.split(',').map(e => e.trim().toLowerCase());
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function validateFile(file) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!effectiveExtensions.includes(ext)) {
      return `Formato invalido. Aceitos: ${effectiveAccept}`;
    }
    if (file.size > 50 * 1024 * 1024) {
      return 'Arquivo muito grande (max 50MB)';
    }
    return null;
  }

  function handleFile(file) {
    setError('');
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSelectedFile(file);
    onFileSelected(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleInputChange(e) {
    const file = e.target.files[0];
    if (file) handleFile(file);
  }

  function handleRemove() {
    setSelectedFile(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-ocean-120 bg-ocean-10' : 'border-ocean-30 hover:border-ocean-60'}
        `}
      >
        <Upload className="w-8 h-8 text-ocean-60 mx-auto mb-2" />
        <p className="text-sm text-ocean-150">
          Arraste seu arquivo aqui ou clique para selecionar
        </p>
        <p className="text-xs text-ocean-60 mt-1">
          {effectiveSubtitle}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={effectiveAccept}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {error && (
        <p className="text-sm text-rose">{error}</p>
      )}

      {selectedFile && (
        <div className="flex items-center gap-3 bg-white border border-ocean-30 rounded-lg p-3">
          <FileSpreadsheet className="w-5 h-5 text-pine flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ocean-180 truncate">{selectedFile.name}</p>
            <p className="text-xs text-ocean-60">{(selectedFile.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleRemove(); }}
            className="text-ocean-60 hover:text-rose"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
