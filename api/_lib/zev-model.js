/** Zev only uses free OpenRouter routes, including when a client requests a paid model. */
export const DEFAULT_ZEV_MODEL = 'openrouter/free';

export function isFreeModel(model) {
  return typeof model === 'string' && (model === DEFAULT_ZEV_MODEL || /^[a-z0-9._-]+\/[a-z0-9._:-]+:free$/i.test(model));
}

export function zevModel(envName = 'ENGINEERING_ZEV_MODEL') {
  const configured = process.env[envName]?.trim();
  return isFreeModel(configured) ? configured : DEFAULT_ZEV_MODEL;
}
