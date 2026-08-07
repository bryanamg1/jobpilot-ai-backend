export function validateBody(schema) {
  return validateRequest(schema, 'body');
}

export function validateParams(schema) {
  return validateRequest(schema, 'params');
}

function validateRequest(schema, target) {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      return next(result.error);
    }

    req[target] = result.data;
    return next();
  };
}
