import type { Editor, JSONContent } from '@tiptap/core';
import { uniquePath } from '../fs/ops';
import { basename, extname, join, relative, sanitizeFileName, stem } from '../lib/path';
import { localDate, localTime } from '../lib/dates';
import { LAYOUT } from '../notebook/model';
import { toast } from '../notebook/store';
import type { DocContextValue } from './context';
import { insertBlocks } from './insertion';

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'];

export function isImageName(name: string) {
  return IMAGE_EXT.includes(extname(name));
}

/** Save files into the doc's attachments folder and return nodes referencing them. */
export async function saveAttachments(files: File[], ctx: DocContextValue): Promise<JSONContent[]> {
  const dir = join(ctx.folder, LAYOUT.attachments, ctx.docId || stem(ctx.path));
  const nodes: JSONContent[] = [];
  for (const file of files) {
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
    toast(files.length === 1 ? `Attached ${files[0].name}` : `Attached ${files.length} files`, 'success');
  } catch (err) {
    toast(`Could not attach files: ${(err as Error).message}`, 'error');
  }
}
