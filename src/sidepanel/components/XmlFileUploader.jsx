import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const COLLAPSED_LIMIT = 5;

function FileList({ files, onRemove, onClearAll }) {
  const [expanded, setExpanded] = useState(false);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const canCollapse = files.length > COLLAPSED_LIMIT;
  const visibleFiles = canCollapse && !expanded ? files.slice(0, COLLAPSED_LIMIT) : files;
  const hiddenCount = files.length - COLLAPSED_LIMIT;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ocean-150">
          {files.length} arquivo{files.length > 1 ? 's' : ''} ({formatSize(totalSize)})
        </p>
        <button
          onClick={(e) => { e.stopPropagation(); onClearAll(); }}
          className="text-xs text-ocean-60 hover:text-rose flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" />
          Limpar todos
        </button>
      </div>

      {files.length > 100 && (
        <p className="text-xs text-yellow-600 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Lotes grandes podem levar mais tempo para processar no navegador.
        </p>
      )}

      <div className="max-h-40 overflow-y-auto space-y-1">
        {visibleFiles.map((file, i) => (
          <div
            key={`${file.name}-${i}`}
            className="flex items-center gap-2 bg-white border border-ocean-30 rounded px-3 py-1.5"
          >
            <FileText className="w-4 h-4 text-ocean-120 flex-shrink-0" />
            <span className="text-xs text-ocean-180 truncate flex-1">{file.name}</span>
            <span className="text-xs text-ocean-60 flex-shrink-0">{formatSize(file.size)}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(i); }}
              className="text-ocean-60 hover:text-rose flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {canCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-ocean-120 hover:text-ocean-180 flex items-center gap-1"
        >
          {expanded ? (
            <><ChevronDown className="w-3 h-3" /> Mostrar menos</>
          ) : (
            <><ChevronRight className="w-3 h-3" /> e mais {hiddenCount} arquivo{hiddenCount > 1 ? 's' : ''}...</>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Componente de upload multiplo de arquivos.
 * Suporta XML (NF-e) e TXT (SPED) via props configuraveis.
 *
 * @param {Object} props
 * @param {(files: File[]) => void} props.onFilesChanged
 * @param {string} [props.accept='.xml'] - Extensoes aceitas (para input e validacao)
 * @param {string} [props.label] - Texto principal da drop zone
 * @param {string} [props.subtitle] - Texto secundario da drop zone
 * @param {number} [props.maxFileSize] - Tamanho maximo por arquivo em bytes
 */
export default function XmlFileUploader({
  onFilesChanged,
  accept = '.xml',
  label = 'Arraste XMLs de NF-e aqui ou clique para selecionar',
  subtitle = 'Aceita multiplos arquivos .xml',
  maxFileSize = 50 * 1024 * 1024,
}) {
  const ACCEPTED_EXTENSIONS = accept.split(',').map(e => e.trim().toLowerCase());
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function validateFile(file) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `${file.name}: formato invalido. Aceito: ${accept}`;
    }
    if (file.size > maxFileSize) {
      return `${file.name}: arquivo muito grande (max ${Math.round(maxFileSize / 1024 / 1024)}MB)`;
    }
    return null;
  }

  function addFiles(newFiles) {
    setError('');
    const errors = [];
    const validFiles = [];

    for (const file of newFiles) {
      const err = validateFile(file);
      if (err) {
        errors.push(err);
      } else {
        // Evitar duplicatas por nome + size + lastModified
        const alreadyAdded = files.some(f =>
          f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        if (!alreadyAdded) {
          validFiles.push(file);
        }
      }
    }

    if (errors.length > 0) {
      setError(errors.join('; '));
    }

    if (validFiles.length > 0) {
      const updated = [...files, ...validFiles];
      setFiles(updated);
      onFilesChanged(updated);
    }
  }

  function removeFile(index) {
    const updated = files.filter((_, i) => i !== index);
    setFiles(updated);
    onFilesChanged(updated);
  }

  function clearAll() {
    setFiles([]);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
    onFilesChanged([]);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) addFiles(dropped);
  }

  function handleInputChange(e) {
    const selected = Array.from(e.target.files);
    if (selected.length > 0) addFiles(selected);
    // Reset input para permitir re-selecao do mesmo arquivo
    e.target.value = '';
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-ocean-120 bg-ocean-10' : 'border-ocean-30 hover:border-ocean-60'}
        `}
      >
        <Upload className="w-8 h-8 text-ocean-60 mx-auto mb-2" />
        <p className="text-sm text-ocean-150">
          {label}
        </p>
        <p className="text-xs text-ocean-60 mt-1">
          {subtitle}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {/* Erro */}
      {error && (
        <p className="text-sm text-rose">{error}</p>
      )}

      {/* Lista de arquivos */}
      {files.length > 0 && (
        <FileList files={files} onRemove={removeFile} onClearAll={clearAll} />
      )}
    </div>
  );
}
