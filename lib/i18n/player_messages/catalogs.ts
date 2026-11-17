import { validatePlayerMessageCatalog } from '@longsightgroup/qti3-player';
import type { InterfaceLocale } from '../locale.ts';
import svSE from './sv-SE.ts';
import enGB from './en-GB.ts';
import enUS from './en-US.ts';
import es419 from './es-419.ts';
import esES from './es-ES.ts';
import type { QflowPlayerMessageCatalog } from './types.ts';

function validate(catalog: QflowPlayerMessageCatalog): QflowPlayerMessageCatalog {
  const result = validatePlayerMessageCatalog(catalog, { requireAllKeys: true });
  if (!result.valid) throw new Error(`Invalid player message catalog for ${catalog.locale}.`);
  return catalog;
}

export const PLAYER_MESSAGE_CATALOGS: Readonly<Record<InterfaceLocale, QflowPlayerMessageCatalog>> =
  {
    'sv-SE': validate(svSE),
    'en-US': validate(enUS),
    'en-GB': validate(enGB),
    'es-ES': validate(esES),
    'es-419': validate(es419),
  };

export function playerMessageCatalogForLocale(locale: InterfaceLocale): QflowPlayerMessageCatalog {
  const selected = PLAYER_MESSAGE_CATALOGS[locale];
  if (!selected) throw new Error(`Unsupported player interface locale: ${locale}`);
  return selected;
}
