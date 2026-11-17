import {
  normalizeInteractionTokenList,
  QTI_MEDIA_PLAYER_CONTROLS,
  type QtiMediaPlayerControls,
} from './shared_vocabulary.ts';

export type { QtiMediaPlayerControls };

const MEDIA_PLAYER_CONTROLS_FIELD_ID = 'media-player-controls';

const MEDIA_PLAYER_CONTROL_LABELS: Record<QtiMediaPlayerControls, string> = {
  none: 'None',
  default: 'Default',
  play: 'Play',
  rewind: 'Rewind',
  captions: 'Captions',
  audioDescription: 'Audio description',
};

export const MEDIA_PLAYER_CONTROL_CHOICES = QTI_MEDIA_PLAYER_CONTROLS.map((value) => ({
  value,
  label: MEDIA_PLAYER_CONTROL_LABELS[value],
}));

function normalizeMediaPlayerControlsList(
  tokens: QtiMediaPlayerControls[] | undefined,
): QtiMediaPlayerControls[] | undefined {
  return normalizeInteractionTokenList(
    MEDIA_PLAYER_CONTROLS_FIELD_ID,
    tokens,
  ) as QtiMediaPlayerControls[] | undefined;
}

export function toggleMediaPlayerControl(
  current: QtiMediaPlayerControls[] | undefined,
  token: QtiMediaPlayerControls,
  enabled: boolean,
): QtiMediaPlayerControls[] | undefined {
  if (enabled) {
    if (token === 'none' || token === 'default') return [token];
    const next = (current ?? []).filter((entry) => entry !== 'none' && entry !== 'default');
    if (!next.includes(token)) next.push(token);
    return normalizeMediaPlayerControlsList(next);
  }
  return normalizeMediaPlayerControlsList((current ?? []).filter((entry) => entry !== token));
}
