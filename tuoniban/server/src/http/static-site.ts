import { extname, sep } from 'node:path';
import express, { type RequestHandler } from 'express';

/**
 * Serves the built web app. Any other GET gets index.html so links such as /assist and
 * /cases/:id/edit work when opened directly, except paths that look like a missing file:
 * those get a plain 404, so a stale script tag fails clearly instead of receiving HTML.
 */
export function staticSite(staticDir: string): RequestHandler[] {
  const files = express.static(staticDir, {
    dotfiles: 'ignore',
    redirect: false,
    setHeaders(res, filePath) {
      // Vite puts a content hash in these filenames, so they can be cached forever.
      const hashed = filePath.includes(`${sep}assets${sep}`);
      res.set('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  const appShell: RequestHandler = (req, res, next) => {
    const isPageRequest = (req.method === 'GET' || req.method === 'HEAD') && extname(req.path) === '';
    if (!isPageRequest) {
      next();
      return;
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root: staticDir }, (err) => {
      if (err) next(err);
    });
  };

  return [files, appShell];
}
