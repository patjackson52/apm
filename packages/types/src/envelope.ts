import { z } from 'zod';

/** Meta carries an index signature in apm-core → passthrough (don't reject extra keys). */
export const MetaSchema = z
  .object({
    api_version: z.literal(1),
    command: z.string(),
    ts: z.string(),
    actor_session: z.string().optional(),
    note: z.string().optional(),
    stale: z.boolean().optional(),
  })
  .passthrough();

export const ErrorBodySchema = z
  .object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    issues: z
      .array(z.object({ field: z.string(), problem: z.string(), got: z.unknown().optional() }))
      .optional(),
  })
  .strict();

/** {ok,data,error,meta} envelope wrapping a typed data schema. */
export const envelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      ok: z.boolean(),
      data: data.nullable(),
      error: ErrorBodySchema.nullable(),
      meta: MetaSchema,
    })
    .strict();

/** Paged list wrapper { items, page:{...} }. */
export const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item),
      page: z
        .object({ total: z.number(), limit: z.number(), offset: z.number(), has_more: z.boolean() })
        .strict(),
    })
    .strict();

export type Meta = z.infer<typeof MetaSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
