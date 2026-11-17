import type { RootPayload } from './root_registry.ts';
import { isValidElement } from 'preact';
export { parseRootPayload, type RootPayload, type RootPayloadResult } from './root_registry.ts';

/** Encode typed plain JSON props as inert HTML script data, including hostile closing-script strings. */
export function encodeRootPayload(value: RootPayload): string {
  return JSON.stringify(value, transportValue).replace(
    /[<>&\u2028\u2029]/g,
    (character) => {
      const code = character.charCodeAt(0).toString(16).padStart(4, '0');
      return `\\u${code}`;
    },
  );
}

/** Check JSON representation during serialization, without reparsing domain props or catalogs. */
function transportValue(this: unknown, key: string, converted: unknown): unknown {
  if (!this || typeof this !== 'object') throw new Error('Invalid hydration JSON container.');
  const descriptor = Object.getOwnPropertyDescriptor(this, key);
  if (descriptor && !('value' in descriptor)) {
    throw new Error('Hydration props cannot use accessors.');
  }
  const original: unknown = descriptor?.value;
  if (original === undefined) {
    if (Array.isArray(this)) throw new Error('Hydration arrays cannot contain undefined values.');
    return undefined;
  }
  if (
    typeof original === 'function' || typeof original === 'symbol' || typeof original === 'bigint'
  ) {
    throw new Error('Hydration props must contain only JSON values.');
  }
  if (typeof original === 'number' && !Number.isFinite(original)) {
    throw new Error('Hydration numbers must be finite.');
  }
  if (original && typeof original === 'object') {
    if (isValidElement(original) && Object.hasOwn(original, 'constructor')) {
      throw new Error('Hydration props cannot contain VNodes.');
    }
    const prototype = Object.getPrototypeOf(original);
    const serializer = Object.getOwnPropertyDescriptor(original, 'toJSON');
    if (
      (Array.isArray(original)
        ? prototype !== Array.prototype && prototype !== null
        : prototype !== Object.prototype && prototype !== null) ||
      Object.getOwnPropertySymbols(original).length ||
      (serializer && (!('value' in serializer) || typeof serializer.value === 'function'))
    ) {
      throw new Error('Hydration props cannot contain rich objects or custom serialization.');
    }
  }
  return converted;
}
