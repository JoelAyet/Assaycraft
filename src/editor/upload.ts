import type { Editor, JSONContent } from '@tiptap/core';
import { uniquePath } from '../fs/ops';
import { basename, extname, join, relative, sanitizeFileName, stem } from '../lib/path';
import { localDate, localTime } from '../lib/dates';
import { LAYOUT } from '../notebook/model';
import { toast } from '../notebook/store';
import type { DocContextValue } from './context';
import { insertBlocks } from './insertion';
import { convertForNotebook } from '../lib/heic';

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic', '.heif'];

export function isImageName(name: string) {
  return IMAGE_EXT.includes(extname(name));
}

/** Save files into the doc's attachments folder and return nodes referencing them. */
export async function saveAttachments(files: File[], ctx: DocContextValue): Promise<JSONContent[]> {
  const dir = join(ctx.folder, LAYOUT.attachments, ctx.docId || stem(ctx.path));
  const nodes: JSONContent[] = [];
  for (const original of files) {
    // iPhone photos (HEIC) are saved as JPEG, which every browser and Markdown viewer shows.
    const { file } = await convertForNotebook(original);
    let name = sanitizeFileName(file.name || 'file');
    if (/^image\.(png|jpe?g|gif|webp)$/i.test(name)) name = `Pasted image ${localDate()} ${localTime().replace(':', '-')}${extname(name)}`;
    const target = await uniquePath(ctx.vault, dir, name);
    await ctx.vault.write(target, file);
    const src = relative(ctx.folder, target);
    if (file.type.startsWith('image/') || isImageName(target)) nodes.push({ type: 'image', attrs: { src, alt: '' } });
    else nodes.push({ type: 'attachment', attrs: { src, name: basename(target) } });
  }
  return nodes;
}

export async function insertFiles(editor: Editor, files: File[], ctx: DocContextValue, pos?: number) {
  if (!files.length) return;
  try {
    const nodes = await saveAttachments(files, ctx);
    if (pos !== undefined) editor.chain().focus().insertContentAt(pos, nodes).run();
    else insertBlocks(editor, nodes);
    const first =
      nodes[0]?.attrs?.name ??
      String(nodes[0]?.attrs?.src ?? files[0].name)
        .split('/')
        .pop();
    const converted = files.some((f) => /\.(heic|heif)$/i.test(f.name)) && nodes.some((n) => /\.jpg$/i.test(String(n.attrs?.src ?? '')));
    toast(files.length === 1 ? `Attached ${String(first)}${converted ? ' (converted from HEIC)' : ''}` : `Attached ${files.length} files`, 'success');
  } catch (err) {
    toast(`Could not attach files: ${(err as Error).message}`, 'error');
  }
}
