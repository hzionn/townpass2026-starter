import express, { type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { CONSENT_VERSION, SERVICE_ID, type FieldId } from '../../../shared/contract.js';
import { apiError } from '../errors.js';

const parseJson = express.json({ limit: '64kb' });

/**
 * Parses JSON up front but holds any error until the route asks for the body. The documented
 * check order puts authorisation and "already submitted" ahead of "bad JSON", so a stranger
 * sending garbage gets 401, not 400.
 */
export const deferredJsonBody: RequestHandler = (req, res, next) => {
  parseJson(req, res, (err?: unknown) => {
    if (err) res.locals.jsonBodyInvalid = true;
    next();
  });
};

/** Checks body structure only. Structure problems are 400; field content is judged later. */
export function parseBody<S extends z.ZodType>(req: Request, res: Response, schema: S): z.output<S> {
  if (res.locals.jsonBodyInvalid) throw apiError('INVALID_JSON');
  let body: unknown;
  try {
    // A missing body counts as {}. On Vercel with helpers on, this property is a getter
    // that throws on malformed JSON, which is why it is read inside the try.
    body = req.body ?? {};
  } catch {
    throw apiError('INVALID_JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw apiError('INVALID_JSON');
  return parsed.data;
}

const Revision = z.number().int().positive();

// zod's strict() rejects unknown keys, so ownerId, helperId, protectedSeed and state cannot
// be slipped in anywhere (spec §10). Every listed key must be present, even with z.unknown().

export const EmptyBody = z.object({}).strict();

export const DemoSessionBody = z.object({ persona: z.enum(['applicant', 'helper']) }).strict();

export const CreateGrantBody = z
  .object({ serviceId: z.literal(SERVICE_ID), consentVersion: z.literal(CONSENT_VERSION) })
  .strict();

/** The value's format is checked by the route: a bad token is INVALID_LINK, not INVALID_JSON. */
export const RedeemBody = z.object({ token: z.unknown() }).strict();

const FormDataShape = z
  .object({
    locationPreference: z.unknown(),
    preferredDate: z.unknown(),
    preferredPeriod: z.unknown(),
    companionRequired: z.unknown(),
    helperName: z.unknown(),
    helperPhone: z.unknown(),
    notes: z.unknown(),
  } satisfies Record<FieldId, z.ZodType>)
  .strict();

export const SaveDraftBody = z.object({ expectedRevision: Revision, formData: FormDataShape }).strict();

export const DeleteAttachmentBody = z.object({ expectedRevision: Revision }).strict();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SubmitBody = z
  .object({ expectedRevision: Revision, idempotencyKey: z.string().regex(UUID_PATTERN) })
  .strict();
