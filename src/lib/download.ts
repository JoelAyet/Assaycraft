export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Opens a native file picker and resolves with the chosen files (empty when cancelled). With
 * `folder`, the user picks a folder instead and gets every file in it, each with its path inside
 * the folder in `webkitRelativePath` (read only: every browser can do this, not only Chromium).
 */
export function pickFiles(opts: { accept?: string; multiple?: boolean; folder?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (opts.accept) input.accept = opts.accept;
    input.multiple = opts.multiple ?? true;
    if (opts.folder) input.webkitdirectory = true;
    input.style.display = 'none';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}
