/**
 * RawXmlViewer — exibe snippet XML com syntax highlighting basico.
 */

function highlightXml(xml) {
  if (!xml) return '';
  // Formatar com indentacao basica
  let formatted = xml;
  try {
    // Tentar formatar com regex simples
    let indent = 0;
    formatted = xml
      .replace(/></g, '>\n<')
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('</')) indent = Math.max(0, indent - 1);
        const result = '  '.repeat(indent) + trimmed;
        if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
          indent++;
        }
        return result;
      })
      .join('\n');
  } catch { /* keep original */ }
  return formatted;
}

// Campos que recebem highlight especial
const HIGHLIGHT_FIELDS = ['CFOP', 'NCM', 'CST', 'CSOSN', 'vProd', 'pICMS', 'vICMS', 'vBC'];

export default function RawXmlViewer({ snippet }) {
  if (!snippet) {
    return <div className="text-xs text-ocean-60 p-2">Sem dados raw disponíveis</div>;
  }

  const formatted = highlightXml(snippet);
  const lines = formatted.split('\n');

  return (
    <div className="bg-ocean-180 rounded-md p-3 overflow-auto max-h-80">
      <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap">
        {lines.map((line, i) => {
          const hasHighlight = HIGHLIGHT_FIELDS.some(f => line.includes(`<${f}>`) || line.includes(`<${f} `));
          return (
            <div
              key={i}
              className={hasHighlight ? 'bg-golden/20 -mx-1 px-1 rounded' : ''}
            >
              {colorizeXmlLine(line)}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function colorizeXmlLine(line) {
  // Simple regex-based coloring for XML
  const parts = [];
  let remaining = line;
  let key = 0;

  while (remaining.length > 0) {
    // Match tag
    const tagMatch = remaining.match(/^(<\/?[\w:]+)/);
    if (tagMatch) {
      parts.push(<span key={key++} className="text-ocean-60">{tagMatch[1]}</span>);
      remaining = remaining.slice(tagMatch[1].length);
      continue;
    }

    // Match closing >
    const closeMatch = remaining.match(/^(\/?>)/);
    if (closeMatch) {
      parts.push(<span key={key++} className="text-ocean-60">{closeMatch[1]}</span>);
      remaining = remaining.slice(closeMatch[1].length);
      continue;
    }

    // Match attribute
    const attrMatch = remaining.match(/^(\s+[\w:]+)(="[^"]*")/);
    if (attrMatch) {
      parts.push(<span key={key++} className="text-golden">{attrMatch[1]}</span>);
      parts.push(<span key={key++} className="text-pine">{attrMatch[2]}</span>);
      remaining = remaining.slice(attrMatch[0].length);
      continue;
    }

    // Text content (between tags)
    const textMatch = remaining.match(/^([^<]+)/);
    if (textMatch) {
      parts.push(<span key={key++} className="text-white">{textMatch[1]}</span>);
      remaining = remaining.slice(textMatch[1].length);
      continue;
    }

    // Fallback: single char
    parts.push(<span key={key++} className="text-white">{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return parts;
}
