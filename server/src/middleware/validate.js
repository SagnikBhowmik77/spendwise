import { HttpError } from '../errors.js';

// validate({ body: schema, query: schema }) parses the request with zod.
// Parsed (trimmed, normalised) values land on req.valid.body / req.valid.query.
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = {};
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || part,
          message: issue.message,
        }));
        return next(new HttpError(400, 'validation_failed', 'Some fields are missing or invalid', details));
      }
      req.valid[part] = result.data;
    }
    next();
  };
}
