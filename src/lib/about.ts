import { version } from '../../package.json';

/** Shown in Settings → About. */
export const ABOUT = {
  name: 'Assaycraft',
  version,
  author: 'Joel Ayet',
  year: 2026,
  /** The hosted app. */
  url: 'https://assaycraftlab.com',
  /** Source code, and a guide to every feature. */
  repo: 'https://github.com/JoelAyet/Assaycraft',
  guide: 'https://github.com/JoelAyet/Assaycraft/blob/HEAD/docs/GUIDE.md',
} as const;
