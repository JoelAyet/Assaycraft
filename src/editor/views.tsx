import { openFileSafely } from '../lib/openFile';
import { NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { generateHTML } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  MoreHorizontal,
  PenLine,
  Blocks,
  Table2,
  Trash2,
} from 'lucide-react';
import { useDocContext } from './context';
import { useVaultBlob } from './useVaultBlob';
import type { Vault } from '../fs/types';
import { SequenceCard } from '../bio/SequenceCard';
import { isSequenceFile } from '../bio/detect';
import { extname, formatBytes, isRelativeFileLink, join, legacySpellings, resolveLink } from '../lib/path';
import { MenuButton, type MenuItemSpec } from '../ui/overlay';
import { navigate, toast, useNotebook } from '../notebook/store';
import { parseMarkdown } from '../markdown/parse';
import { schemaExtensions } from './schema';
import { readDoc, relocateContent, resolveInclude } from '../notebook/actions';
import { expandIncludes } from '../templates/engine';
import { parseDelimited, sniffDelimiter } from '../sheet/tsv';
import { normalizeSheet } from '../sheet/model';
import { PdfView } from '../ui/PdfView';
import { decodeTiff, isTiffName, type TiffPreview } from '../lib/tiff';
import { heicToJpeg, isHeicName } from '../lib/heic';
import { AnnotationEditor, AnnotationLayer, normalizeAnnotations, type Annotation } from './annotate';
import { writeClipboard } from '../lib/clipboard';
import { columnName, isXlsxName, openXlsx, type XlsxBook, type XlsxSheet } from '../lib/xlsx';

function useEditable(editor: NodeViewProps['editor']) {
  return useEditorState({ editor, selector: (s) => s.editor.isEditable });
}

function vaultPathOf(folder: string, src: string): string | null {
  return src && isRelativeFileLink(src) ? resolveLink(folder, src) : null;
}

/**
 * A file that is not at its link: if it was added before November 2026 with "#" or "?" in its name, the
 * link may have been saved under an older spelling. Find the file and put the link right.
 */
function useRepairLink(vault: Vault, folder: string, src: string, missing: boolean, setSrc: (src: string) => void) {
  const set = useRef(setSrc);
  set.current = setSrc;
  useEffect(() => {
    if (!missing || !isRelativeFileLink(src)) return;
    let cancelled = false;
    void (async () => {
      for (const alt of legacySpellings(src)) {
        if (await vault.exists(join(folder, alt)).catch(() => false)) {
          if (!cancelled) set.current(alt);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, folder, src, missing]);
}

// ───────────── Image ─────────────

const WIDTHS: { label: string; value: string | null }[] = [
  { label: 'S', value: '25%' },
  { label: 'M', value: '50%' },
  { label: 'L', value: '75%' },
  { label: 'Full', value: null },
];

/** A TIFF drawn as a PNG the browser can show, one page at a time; the file stays as it is. */
function useTiffPreview(blob: Blob | null, page: number) {
  const [state, setState] = useState<{ url: string | null; info: Omit<TiffPreview, 'rgba'> | null; error: string | null }>({
    url: null,
    info: null,
    error: null,
  });
  useEffect(() => {
    if (!blob) return;
    let url: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { rgba, ...info } = await decodeTiff(await blob.arrayBuffer(), page);
        const canvas = document.createElement('canvas');
        canvas.width = info.width;
        canvas.height = info.height;
        canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), info.width, info.height), 0, 0);
        const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
        if (cancelled) return;
        if (!png) throw new Error('Could not draw it');
        url = URL.createObjectURL(png);
        setState({ url, info, error: null });
      } catch (err) {
        if (!cancelled) setState({ url: null, info: null, error: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, page]);
  return state;
}

/** A HEIC photo (attached before Assaycraft converted them) drawn as a JPEG for display; the file stays as it is. */
function useHeicPreview(blob: Blob | null) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!blob) return;
    let url: string | null = null;
    let cancelled = false;
    heicToJpeg(blob, 0.85).then(
      (jpeg) => {
        if (cancelled) return;
        url = URL.createObjectURL(jpeg);
        setState({ url, error: null });
      },
      (err: Error) => !cancelled && setState({ url: null, error: err.message }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob]);
  return state;
}

export function ImageView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const ctx = useDocContext();
  const editable = useEditable(editor);
  const src = String(node.attrs.src ?? '');
  const name = src.split('/').pop() ?? src;
  const path = vaultPathOf(ctx.folder, src);
  const { blob, url, error } = useVaultBlob(ctx.vault, path);
  useRepairLink(ctx.vault, ctx.folder, src, !!error, (fixed) => updateAttributes({ src: fixed }));
  const fileUrl = path ? url : src;
  const tiff = isTiffName(src);
  const [page, setPage] = useState(0);
  const preview = useTiffPreview(tiff ? blob : null, page);
  const heic = isHeicName(src);
  const heicPreview = useHeicPreview(heic ? blob : null);
  const shownUrl = tiff ? preview.url : heic ? heicPreview.url : fileUrl;
  const marks = useMemo(() => normalizeAnnotations(node.attrs.marks), [node.attrs.marks]);
  const [aspect, setAspect] = useState(0);
  const [drawing, setDrawing] = useState(false);
  // Formats the browser can't draw (HEIC from a phone, an unusual TIFF): say so instead of showing a blank line.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [shownUrl]);
  const cannotShow = broken
    ? 'This browser can’t show this kind of image.'
    : tiff && preview.error
      ? `Can’t preview this TIFF: ${preview.error}.`
      : heic && heicPreview.error
        ? `Can’t show this HEIC photo: ${heicPreview.error}.`
        : null;
  const width = (node.attrs.width as string | null) ?? null;
  const info = tiff ? preview.info : null;
  return (
    <NodeViewWrapper
      className={`gc-image ${selected ? 'is-selected' : ''} ${drawing ? 'is-drawing' : ''}`}
      data-drag-handle={drawing ? undefined : ''}
    >
      <figure style={{ width: width ?? undefined }}>
        {error ? (
          <div className="gc-missing">
            <FileImage /> Image not found: {src}
          </div>
        ) : cannotShow ? (
          <div className="gc-image-fallback" contentEditable={false}>
            <FileImage />
            <span className="gc-image-fallback-text">
              <strong>{name}</strong>
              <span>{cannotShow} The file is kept as it is; download it to open it in another app.</span>
            </span>
            {fileUrl && (
              <a className="btn btn-sm" href={fileUrl} download={name}>
                <Download /> Download
              </a>
            )}
            {editable && (
              <button className="icon-btn" title="Remove image" onClick={() => deleteNode()}>
                <Trash2 />
              </button>
            )}
          </div>
        ) : shownUrl ? (
          <div className="gc-image-frame">
            <img
              src={shownUrl}
              alt={String(node.attrs.alt ?? '')}
              draggable={false}
              onError={() => setBroken(true)}
              onLoad={(e) => setAspect(e.currentTarget.naturalWidth / (e.currentTarget.naturalHeight || 1))}
              onDoubleClick={() => {
                if (drawing || !shownUrl) return;
                // A picture made here (of a TIFF or HEIC) is safe to open; the notebook's own file is opened safely.
                if (!path) window.open(shownUrl, '_blank', 'noopener');
                else if ((tiff || heic) && shownUrl !== fileUrl) window.open(shownUrl, '_blank', 'noopener');
                else if (blob) void openFileSafely(blob, name);
              }}
            />
            {drawing && aspect ? (
              <AnnotationEditor
                marks={marks}
                aspect={aspect}
                onChange={(next: Annotation[]) => updateAttributes({ marks: next.length ? next : null })}
                onDone={() => setDrawing(false)}
              />
            ) : (
              <AnnotationLayer marks={marks} aspect={aspect} />
            )}
          </div>
        ) : (
          <div className="gc-image-loading" />
        )}
        {info && !cannotShow && (
          <div className="gc-image-meta" contentEditable={false}>
            <span>
              TIFF · {info.width} × {info.height} · {info.bits}-bit{info.stretched ? ', contrast stretched for display' : ''}
            </span>
            {info.pages > 1 && (
              <span className="gc-image-pages">
                <button className="icon-btn" title="Previous page" disabled={info.page === 0} onClick={() => setPage(info.page - 1)}>
                  <ChevronLeft />
                </button>
                Page {info.page + 1} of {info.pages}
                <button className="icon-btn" title="Next page" disabled={info.page >= info.pages - 1} onClick={() => setPage(info.page + 1)}>
                  <ChevronRight />
                </button>
              </span>
            )}
          </div>
        )}
        {(editable || node.attrs.alt) && (
          <input
            className="gc-caption"
            value={String(node.attrs.alt ?? '')}
            placeholder={editable ? 'Add a caption…' : ''}
            readOnly={!editable}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
          />
        )}
        {editable && !cannotShow && !drawing && (
          <div className="gc-image-tools" contentEditable={false}>
            <button
              className="gc-chip-btn"
              title="Draw lines, arrows, boxes and text on the image"
              onClick={() => setDrawing(true)}
              disabled={!aspect}
            >
              <PenLine /> Annotate
            </button>
            {WIDTHS.map((w) => (
              <button
                key={w.label}
                className={`gc-chip-btn ${width === w.value ? 'active' : ''}`}
                onClick={() => updateAttributes({ width: w.value })}
              >
                {w.label}
              </button>
            ))}
            {fileUrl && (
              <a className="gc-chip-btn" href={fileUrl} download={name} title="Download">
                <Download />
              </a>
            )}
            <button className="gc-chip-btn" title="Remove image" onClick={() => deleteNode()}>
              <Trash2 />
            </button>
          </div>
        )}
      </figure>
    </NodeViewWrapper>
  );
}

// ───────────── File attachment (incl. SnapGene / GenBank viewer) ─────────────

function fileIcon(ext: string) {
  if (['.pdf'].includes(ext)) return <FileType2 />;
  if (['.csv', '.tsv', '.xlsx', '.xls', '.ods'].includes(ext)) return <FileSpreadsheet />;
  if (['.txt', '.md', '.doc', '.docx', '.rtf', '.json'].includes(ext)) return <FileText />;
  if (['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.gif'].includes(ext)) return <FileImage />;
  return <File />;
}

function CsvPreview({ blob, name, onInsert }: { blob: Blob; name: string; onInsert: (rows: string[][]) => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  useEffect(() => {
    void blob.text().then((t) => setRows(parseDelimited(t, name.endsWith('.tsv') ? '\t' : sniffDelimiter(t))));
  }, [blob, name]);
  if (!rows) return null;
  return (
    <div className="gc-csv">
      <div className="gc-csv-scroll">
        <table>
          <tbody>
            {rows.slice(0, 12).map((r, i) => (
              <tr key={i}>{r.slice(0, 12).map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="gc-csv-foot">
        <span className="muted">
          {rows.length} rows × {rows[0]?.length ?? 0} columns
        </span>
        <button className="btn btn-sm" onClick={() => onInsert(rows)}>
          <Table2 /> Insert as table
        </button>
      </div>
    </div>
  );
}

/** An Excel workbook: its sheets as tabs, each shown like a spreadsheet (the first rows and columns). */
function XlsxPreview({ blob, onInsert }: { blob: Blob; onInsert: (rows: string[][]) => void }) {
  const [book, setBook] = useState<XlsxBook | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let live = true;
    setBook(null);
    setFailed(null);
    void blob.arrayBuffer().then((buf) => {
      if (!live) return;
      try {
        setBook(openXlsx(new Uint8Array(buf)));
        setIndex(0);
      } catch (err) {
        setFailed((err as Error).message || 'The workbook could not be read');
      }
    });
    return () => {
      live = false;
    };
  }, [blob]);
  const sheet = useMemo((): XlsxSheet | null => {
    if (!book) return null;
    try {
      return book.read(index);
    } catch {
      return { name: '', rows: [], numeric: [], truncated: false, tooLarge: true };
    }
  }, [book, index]);
  if (failed) return <p className="gc-xlsx-note">Can’t preview this workbook: {failed}.</p>;
  if (!book || !sheet) return <p className="gc-xlsx-note">Reading the workbook…</p>;
  const rows = sheet.rows.slice(0, XLSX_SHOWN_ROWS);
  const cols = Math.min(sheet.rows[0]?.length ?? 0, XLSX_SHOWN_COLS);
  const more = sheet.rows.length > rows.length || (sheet.rows[0]?.length ?? 0) > cols;
  return (
    <div className="gc-csv gc-xlsx">
      {book.sheets.length > 1 && (
        <div className="gc-xlsx-tabs" role="tablist" aria-label="Sheets">
          {book.sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`gc-xlsx-tab ${i === index ? 'is-active' : ''}`}
              onClick={() => setIndex(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.tooLarge ? (
        <p className="gc-xlsx-note">This sheet can’t be previewed here (it is very large or damaged). Download the file to open it in Excel.</p>
      ) : !rows.length ? (
        <p className="gc-xlsx-note">This sheet is empty.</p>
      ) : (
        <div className="gc-csv-scroll">
          <table>
            <thead>
              <tr>
                <th className="gc-xlsx-corner" aria-hidden="true" />
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} scope="col">
                    {columnName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row" className="gc-xlsx-rn">
                    {i + 1}
                  </th>
                  {r.slice(0, cols).map((cell, j) => (
                    <td key={j} className={sheet.numeric[i]?.[j] ? 'is-num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="gc-csv-foot">
        <span className="muted">
          {sheet.rows.length} rows × {sheet.rows[0]?.length ?? 0} columns
          {more ? ` · showing the first ${rows.length} rows and ${cols} columns` : ''}
          {sheet.truncated ? ' (the file has more)' : ''}
        </span>
        {rows.length > 0 && (
          <button className="btn btn-sm" onClick={() => onInsert(sheet.rows)}>
            <Table2 /> Insert as table
          </button>
        )}
      </div>
    </div>
  );
}

const XLSX_SHOWN_ROWS = 200;
const XLSX_SHOWN_COLS = 40;

export function AttachmentView({ node, selected, editor, deleteNode, getPos, updateAttributes }: NodeViewProps) {
  const ctx = useDocContext();
  const editable = useEditable(editor);
  const src = String(node.attrs.src ?? '');
  const path = vaultPathOf(ctx.folder, src);
  const { blob, url, error } = useVaultBlob(ctx.vault, path);
  useRepairLink(ctx.vault, ctx.folder, src, !!error, (fixed) => {
    // The name shown was taken from the old spelling too.
    const oldName = src.split('/').pop();
    const name = String(node.attrs.name ?? '');
    updateAttributes({ src: fixed, ...(name && name === oldName ? { name: fixed.split('/').pop() } : {}) });
  });
  const name = String(node.attrs.name || src.split('/').pop() || 'file');
  const ext = extname(name || src);
  const isSeq = isSequenceFile(name) || isSequenceFile(src);
  const xlsx = isXlsxName(name) || isXlsxName(src);
  const canPreview = ext === '.pdf' || ext === '.csv' || ext === '.tsv' || ext === '.txt' || xlsx;
  const [preview, setPreview] = useState(false);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (preview && ext === '.txt' && blob) void blob.text().then((t) => setText(t.slice(0, 20000)));
  }, [preview, ext, blob]);

  const menu: MenuItemSpec[] = [
    ...(blob ? [{ label: 'Open in new tab', icon: <Eye />, onSelect: () => void openFileSafely(blob, name) }] : []),
    ...(path
      ? [
          {
            label: 'Copy file location',
            icon: <Copy />,
            onSelect: () => void writeClipboard(path).then(() => toast('File location copied', 'success')),
          },
        ]
      : []),
    ...(editable ? (['sep', { label: 'Remove from entry', icon: <Trash2 />, danger: true, onSelect: () => deleteNode() }] as MenuItemSpec[]) : []),
  ];

  const insertTable = (rows: string[][]) => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    editor
      .chain()
      .focus()
      .insertContentAt(pos + node.nodeSize, { type: 'spreadsheet', attrs: { data: normalizeSheet({ rows }) } })
      .run();
  };

  const actionsMenu = (
    <MenuButton items={menu} className="icon-btn" title="More">
      <MoreHorizontal />
    </MenuButton>
  );

  if (isSeq && blob) {
    return (
      <NodeViewWrapper className={`gc-file gc-file-seq ${selected ? 'is-selected' : ''}`} data-drag-handle="">
        <div contentEditable={false}>
          <SequenceCard blob={blob} fileName={name} url={url} vaultPath={path} storage={ctx.vault.kind} actions={actionsMenu} />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className={`gc-file ${selected ? 'is-selected' : ''}`} data-drag-handle="">
      <div className="gc-file-card" contentEditable={false}>
        <span className="gc-file-icon">{fileIcon(ext)}</span>
        <div className="gc-file-meta">
          <a className="gc-file-name" href={url ?? undefined} download={name} onClick={(e) => !url && e.preventDefault()}>
            {name}
          </a>
          <span className="gc-file-sub">
            {error ? (
              <span className="gc-warn">File not found in the notebook folder</span>
            ) : blob ? (
              `${formatBytes(blob.size)} · ${ext.replace('.', '').toUpperCase() || 'FILE'}`
            ) : (
              '…'
            )}
          </span>
        </div>
        <div className="gc-file-actions">
          {canPreview && blob && (
            <button
              className={`icon-btn ${preview ? 'active' : ''}`}
              title={preview ? 'Hide preview' : 'Preview'}
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? <EyeOff /> : <Eye />}
            </button>
          )}
          {url && (
            <a className="icon-btn" href={url} download={name} title="Download">
              <Download />
            </a>
          )}
          {actionsMenu}
        </div>
      </div>
      {preview && ext === '.pdf' && blob && (
        <div className="gc-pdf" contentEditable={false}>
          <PdfView blob={blob} name={name} />
        </div>
      )}
      {preview && (ext === '.csv' || ext === '.tsv') && blob && <CsvPreview blob={blob} name={name} onInsert={insertTable} />}
      {preview && xlsx && blob && <XlsxPreview blob={blob} onInsert={insertTable} />}
      {preview && ext === '.txt' && text !== null && <pre className="gc-text-preview">{text}</pre>}
    </NodeViewWrapper>
  );
}

// ───────────── Sub-template reference ─────────────

export function IncludeView({ node, selected, editor, deleteNode, getPos }: NodeViewProps) {
  const ctx = useDocContext();
  const editable = useEditable(editor);
  const ref = String(node.attrs.ref ?? '');
  const name = String(node.attrs.name ?? ref);
  const target = useNotebook((s) =>
    Object.values(s.docs).find((d) => (d.kind === 'subtemplate' || d.kind === 'template') && (d.id === ref || (!ref && d.title === name))),
  );
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState('');

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    void readDoc(target.path).then(({ body }) => {
      if (cancelled) return;
      try {
        setHtml(generateHTML(parseMarkdown(body).toJSON(), schemaExtensions()));
      } catch {
        setHtml('');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, target?.path, target?.mtime]);

  const inline = async () => {
    const pos = getPos();
    if (typeof pos !== 'number' || !target) return;
    const { body } = await readDoc(target.path);
    const doc = parseMarkdown(body).toJSON();
    const expanded = await expandIncludes(doc, target.path.split('/').slice(0, -1).join('/'), resolveInclude, [target.id]);
    const relocated = await relocateContent(expanded, '', { folder: ctx.folder, id: ctx.docId });
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, relocated.content ?? [])
      .run();
  };

  const menu: MenuItemSpec[] = [
    ...(target ? [{ label: 'Open sub-template', icon: <Blocks />, onSelect: () => navigate({ name: 'doc', path: target.path }) }] : []),
    ...(editable && target ? [{ label: 'Replace with an editable copy', icon: <Copy />, onSelect: () => void inline() }] : []),
    ...(editable ? (['sep', { label: 'Remove', icon: <Trash2 />, danger: true, onSelect: () => deleteNode() }] as MenuItemSpec[]) : []),
  ];

  const inEntry = ctx.kind !== 'template' && ctx.kind !== 'subtemplate';

  return (
    <NodeViewWrapper className={`gc-include ${selected ? 'is-selected' : ''} ${target ? '' : 'is-missing'}`} data-drag-handle="">
      <div className="gc-include-head" contentEditable={false}>
        <button className="icon-btn icon-btn-sm" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse' : 'Preview'}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </button>
        <Blocks className="gc-include-icon" />
        <span className="gc-include-label">Sub-template</span>
        <button className="gc-include-name" onClick={() => (target ? navigate({ name: 'doc', path: target.path }) : undefined)}>
          {target?.title ?? name}
        </button>
        {!target && <span className="pill pill-sq tone-red">not found</span>}
        {target?.description && <span className="gc-include-desc">{target.description}</span>}
        <span className="spacer" />
        {inEntry && target && editable && (
          <button className="btn btn-sm" onClick={() => void inline()}>
            Expand here
          </button>
        )}
        <MenuButton items={menu} className="icon-btn icon-btn-sm" title="Sub-template options">
          <MoreHorizontal />
        </MenuButton>
      </div>
      {open && (
        <div className="gc-include-preview gc-prose" contentEditable={false}>
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="muted">{target ? 'Empty sub-template' : 'This sub-template no longer exists.'}</span>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

// ───────────── Raw HTML kept verbatim ─────────────

export function RawView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const [edit, setEdit] = useState(false);
  const content = String(node.attrs.content ?? '');
  const rows = useMemo(() => Math.min(16, content.split('\n').length + 1), [content]);
  return (
    <NodeViewWrapper className={`gc-raw ${selected ? 'is-selected' : ''}`}>
      <div className="gc-raw-head" contentEditable={false}>
        <Code2 /> Raw HTML / Markdown (kept as-is)
        <span className="spacer" />
        {editable && (
          <button className="btn btn-sm btn-ghost" onClick={() => setEdit((e) => !e)}>
            {edit ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {edit ? (
        <textarea className="gc-raw-edit mono" value={content} rows={rows} onChange={(e) => updateAttributes({ content: e.target.value })} />
      ) : (
        <pre className="gc-raw-pre" contentEditable={false}>
          {content}
        </pre>
      )}
    </NodeViewWrapper>
  );
}
