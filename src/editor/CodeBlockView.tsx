/**
 * The bar above a code block: its language, Copy, and for long code Expand / Collapse (a small
 * block scrolls; expanded, all of it shows).
 */
import { NodeViewContent, NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { Check, ChevronsDownUp, ChevronsUpDown, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { writeClipboard } from '../lib/clipboard';
import { toast } from '../notebook/store';
import { CODE_LANGUAGES, LONG_CODE_LINES, languageValue, loadHighlighter } from './codeBlock';

export function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const editable = useEditorState({ editor, selector: (s) => s.editor.isEditable });
  const language = (node.attrs.language as string | null) ?? null;
  const value = languageValue(language);
  const known = CODE_LANGUAGES.some((l) => l.value === value);
  const code = node.textContent;
  const lines = code ? code.split('\n').length : 1;
  const long = lines > LONG_CODE_LINES;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [guess, setGuess] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  // With no language named, say which one the colors were guessed from.
  useEffect(() => {
    if (value) return setGuess(null);
    let live = true;
    const t = setTimeout(() => void loadHighlighter().then((hl) => live && setGuess(hl.guessLanguage(code))), 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value, code]);

  const copy = () =>
    void writeClipboard(code).then(
      () => setCopied(true),
      () => toast('Could not copy the code', 'error'),
    );

  const guessedLabel = guess ? CODE_LANGUAGES.find((l) => l.value === guess)?.label : null;
  const autoLabel = guessedLabel ? `Auto (${guessedLabel})` : 'Auto-detect';
  const shownLabel = value ? (CODE_LANGUAGES.find((l) => l.value === value)?.label ?? language) : autoLabel;

  return (
    <NodeViewWrapper className={`gc-code ${long ? 'is-long' : ''} ${long && !expanded ? 'is-collapsed' : ''}`} data-language={value || undefined}>
      <div className="gc-code-bar" contentEditable={false}>
        {editable ? (
          <select
            className="gc-code-lang"
            aria-label="Code language"
            value={value}
            onChange={(e) => updateAttributes({ language: e.target.value || null })}
          >
            <option value="">{autoLabel}</option>
            {!known && value && <option value={value}>{language}</option>}
            {CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="gc-code-lang is-static">{shownLabel}</span>
        )}
        <span className="gc-code-spacer" />
        {long && (
          <span className="gc-code-lines" aria-hidden="true">
            {lines} lines
          </span>
        )}
        {long && (
          <button
            type="button"
            className="gc-code-btn"
            aria-expanded={expanded}
            title={expanded ? 'Make the block small again' : 'Show all of the code'}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
            <span>{expanded ? 'Collapse' : 'Expand'}</span>
          </button>
        )}
        <button type="button" className="gc-code-btn" title="Copy the code to the clipboard" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<'code'> as="code" className={value ? `language-${value}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}
