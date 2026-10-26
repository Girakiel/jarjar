import { CopyButton } from './ui';

export function trackerOrigin(): string {
  return window.location.origin;
}

export function snippetFor(siteId: string): string {
  return `<script async src="${trackerOrigin()}/t.js" data-site="${siteId}"></script>`;
}

/** Tiny highlighter for the one-line install snippet. */
function highlight(code: string) {
  return code.split(/(<\/?script|>|\s[\w-]+=|"[^"]*")/g).map((part, i) => {
    if (part.startsWith('<')) return <span key={i} className="tok-tag">{part}</span>;
    if (part === '>') return <span key={i} className="tok-tag">{part}</span>;
    if (/^\s[\w-]+=$/.test(part)) return <span key={i} className="tok-attr">{part}</span>;
    if (part.startsWith('"')) return <span key={i} className="tok-str">{part}</span>;
    return part;
  });
}

export function Snippet({ siteId }: { siteId: string }) {
  const code = snippetFor(siteId);
  return (
    <div className="snippet">
      <pre>
        <code>{highlight(code)}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="snippet">
      <pre>
        <code>
          {code.split('\n').map((line, i) => (
            <span key={i}>
              {line.trim().startsWith('//') ? <span className="tok-com">{line}</span> : line}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}
