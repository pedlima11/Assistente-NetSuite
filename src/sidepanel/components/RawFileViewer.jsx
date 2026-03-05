/**
 * RawFileViewer — modal para exibir arquivo original completo.
 *
 * Suporta XML e SPED (.txt) com busca textual.
 */
import { useState, useRef, useEffect } from 'react';

export default function RawFileViewer({ files, isOpen, onClose }) {
  const [selectedFile, setSelectedFile] = useState(0);
  const [search, setSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    setMatchIndex(0);
  }, [search, selectedFile]);

  if (!isOpen || !files || files.length === 0) return null;

  const file = files[selectedFile];
  const content = file?.content || '';
  const lines = content.split('\n');

  // Busca
  const matchedLines = search
    ? lines.reduce((acc, line, i) => {
        if (line.toLowerCase().includes(search.toLowerCase())) acc.push(i);
        return acc;
      }, [])
    : [];

  const scrollToMatch = (idx) => {
    if (!contentRef.current || matchedLines.length === 0) return;
    const lineIdx = matchedLines[idx];
    const lineEl = contentRef.current.querySelector(`[data-line="${lineIdx}"]`);
    if (lineEl) lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setMatchIndex(idx);
  };

  const handleNextMatch = () => {
    if (matchedLines.length === 0) return;
    const next = (matchIndex + 1) % matchedLines.length;
    scrollToMatch(next);
  };

  const handlePrevMatch = () => {
    if (matchedLines.length === 0) return;
    const prev = (matchIndex - 1 + matchedLines.length) % matchedLines.length;
    scrollToMatch(prev);
  };

  return (
    <div className="fixed inset-0 bg-ocean-180/80 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-ocean-30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-ocean-180">Arquivo Original</span>
            {files.length > 1 && (
              <select
                value={selectedFile}
                onChange={e => setSelectedFile(Number(e.target.value))}
                className="text-xs border border-ocean-30 rounded px-1.5 py-0.5"
              >
                {files.map((f, i) => (
                  <option key={i} value={i}>{f.name}</option>
                ))}
              </select>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ocean-60 hover:text-ocean-180 text-lg leading-none"
          >×</button>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ocean-30">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar no arquivo..."
            className="flex-1 text-xs border border-ocean-30 rounded px-2 py-1 focus:outline-none focus:border-ocean-120"
          />
          {matchedLines.length > 0 && (
            <>
              <span className="text-[10px] text-ocean-60">
                {matchIndex + 1}/{matchedLines.length}
              </span>
              <button onClick={handlePrevMatch} className="text-xs text-ocean-120 hover:text-ocean-180">↑</button>
              <button onClick={handleNextMatch} className="text-xs text-ocean-120 hover:text-ocean-180">↓</button>
            </>
          )}
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-auto p-3 bg-ocean-180">
          <pre className="text-[11px] leading-relaxed font-mono">
            {lines.map((line, i) => {
              const isMatch = search && line.toLowerCase().includes(search.toLowerCase());
              const isCurrentMatch = matchedLines[matchIndex] === i;

              return (
                <div
                  key={i}
                  data-line={i}
                  className={`${
                    isCurrentMatch
                      ? 'bg-golden/40'
                      : isMatch
                        ? 'bg-golden/15'
                        : ''
                  }`}
                >
                  <span className="text-ocean-60 select-none inline-block w-12 text-right mr-3">
                    {i + 1}
                  </span>
                  <span className="text-ocean-30">{line}</span>
                </div>
              );
            })}
          </pre>
        </div>
      </div>
    </div>
  );
}
