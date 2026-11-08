import supertest from 'supertest';
import type { Persona } from '../../../shared/contract.js';
import { REQUIREMENT_ID } from '../../../shared/contract.js';
import { PDF_BYTES } from './files.js';
import type { Harness } from './harness.js';

export interface UploadOptions {
  bytes?: Buffer;
  filename?: string;
  contentType?: string;
  /** null leaves the field out. */
  expectedRevision?: number | string | null;
  requirementId?: string | null;
  /** Attach a second file in the same request. */
  secondFile?: boolean;
  /** Put the file part before the text fields. */
  fileFirst?: boolean;
}

/**
 * One browser: its own cookie jar, and the right Origin on every write. Records every
 * response body for the privacy test.
 */
export class Browser {
  readonly agent: ReturnType<typeof supertest.agent>;
  readonly #h: Harness;

  constructor(h: Harness) {
    this.#h = h;
    this.agent = supertest.agent(h.server);
  }

  async #track(request: supertest.Test): Promise<supertest.Response> {
    const res = await request;
    this.#h.responses.push(res.text ?? '');
    return res;
  }

  get(path: string): Promise<supertest.Response> {
    return this.#track(this.agent.get(path));
  }

  post(path: string, body?: unknown): Promise<supertest.Response> {
    const request = this.agent.post(path).set('Origin', this.#h.config.publicOrigin);
    return this.#track(body === undefined ? request : request.send(body as object));
  }

  patch(path: string, body: unknown): Promise<supertest.Response> {
    return this.#track(this.agent.patch(path).set('Origin', this.#h.config.publicOrigin).send(body as object));
  }

  delete(path: string, body: unknown): Promise<supertest.Response> {
    return this.#track(this.agent.delete(path).set('Origin', this.#h.config.publicOrigin).send(body as object));
  }

  /** Raw JSON text, for malformed-body tests. */
  sendRaw(method: 'post' | 'patch' | 'delete', path: string, text: string): Promise<supertest.Response> {
    return this.#track(
      this.agent[method](path).set('Origin', this.#h.config.publicOrigin).set('Content-Type', 'application/json').send(text),
    );
  }

  upload(caseId: string, options: UploadOptions = {}): Promise<supertest.Response> {
    let request = this.agent.post(`/api/cases/${caseId}/attachments`).set('Origin', this.#h.config.publicOrigin);
    const attachFile = () => {
      request = request.attach('file', options.bytes ?? PDF_BYTES, {
        filename: options.filename ?? 'practice.pdf',
        contentType: options.contentType ?? 'application/pdf',
      });
      if (options.secondFile) {
        request = request.attach('file', PDF_BYTES, { filename: 'second.pdf', contentType: 'application/pdf' });
      }
    };
    if (options.fileFirst) attachFile();
    if (options.requirementId !== null) request = request.field('requirementId', options.requirementId ?? REQUIREMENT_ID);
    if (options.expectedRevision !== null && options.expectedRevision !== undefined) {
      request = request.field('expectedRevision', String(options.expectedRevision));
    }
    if (!options.fileFirst) attachFile();
    return this.#track(request);
  }

  async login(persona: Persona): Promise<this> {
    const res = await this.post('/api/demo/session', { persona });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
    return this;
  }
}
