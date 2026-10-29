import { version as release } from '../../package.json';

/** “1.1.0” is shown as “1.1”; a patch release keeps its third number (“1.1.2”). */
const version = release.replace(/\.0$/, '');

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
