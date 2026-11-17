declare const redactedBrand: unique symbol;

/** Opaque wrapper that prevents a secret from being logged or serialized accidentally. */
export type Redacted<T> = {
  readonly [redactedBrand]: T;
  readonly toString: () => '[REDACTED]';
  readonly toJSON: () => '[REDACTED]';
};

const redactedValues = new WeakMap<object, unknown>();

/** Wraps one secret value without exposing it as an enumerable property. */
export function redact<T>(value: T): Redacted<T> {
  const wrapper = Object.freeze({
    toString: () => '[REDACTED]' as const,
    toJSON: () => '[REDACTED]' as const,
  });
  redactedValues.set(wrapper, value);
  // SAFETY: redactedValues is the only storage for the value and reveal is the only accessor.
  return wrapper as Redacted<T>;
}

/** Reveals a redacted value only at the boundary that needs the raw secret. */
export function reveal<T>(redacted: Redacted<T>): T {
  if (!redactedValues.has(redacted)) throw new TypeError('Invalid redacted value.');
  // SAFETY: redact stored the value for this exact opaque wrapper.
  return redactedValues.get(redacted) as T;
}
