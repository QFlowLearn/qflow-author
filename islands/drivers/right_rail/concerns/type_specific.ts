import type { Draft } from '../../../../lib/types/draft.ts';
import type { RailDraft } from '../rail_draft.ts';
import type { ControlPatch, RailBuildContext, SettingsAssign } from './context.ts';
import type { DriverSettingsValues } from '../settings_contract.ts';

export function mediaControls(ctx: RailBuildContext): ControlPatch {
  if (ctx.typeId !== 'media') return {};
  const { draft, setDraft } = ctx;
  return {
    mediaInteractionLabel: {
      value: draft.mediaInteractionLabel ?? '',
      onChange: (next) => setDraft({ mediaInteractionLabel: next }),
    },
    mediaAutostart: {
      value: Boolean(draft.mediaAutostart),
      onChange: (next) => setDraft({ mediaAutostart: next }),
    },
    mediaLoop: {
      value: Boolean(draft.mediaLoop),
      onChange: (next) => setDraft({ mediaLoop: next }),
    },
    mediaMinPlays: {
      value: draft.mediaMinPlays,
      onChange: (next) => setDraft({ mediaMinPlays: next }),
    },
    mediaMaxPlays: {
      value: draft.mediaMaxPlays,
      onChange: (next) => setDraft({ mediaMaxPlays: next }),
    },
    mediaCoords: {
      value: draft.mediaCoords ?? '',
      onChange: (next) => setDraft({ mediaCoords: next }),
    },
    mediaWidth: {
      value: draft.mediaWidth,
      onChange: (next) => setDraft({ mediaWidth: next }),
    },
    mediaHeight: {
      value: draft.mediaHeight,
      onChange: (next) => setDraft({ mediaHeight: next }),
    },
  };
}

export function mediaSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    mediaKind: draft.mediaKind ?? 'video',
    mediaInteractionLabel: draft.mediaInteractionLabel ?? '',
    mediaObjectLabel: draft.mediaObjectLabel ?? '',
    mediaAutostart: draft.mediaAutostart,
    mediaLoop: draft.mediaLoop,
    mediaMinPlays: draft.mediaMinPlays,
    mediaMaxPlays: draft.mediaMaxPlays,
    mediaCoords: draft.mediaCoords ?? '',
    mediaWidth: draft.mediaWidth,
    mediaHeight: draft.mediaHeight,
  };
}

export function applyMediaSettings(
  typeId: string,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (
    typeId === 'media' &&
    (settings.mediaKind === 'video' ||
      settings.mediaKind === 'audio' ||
      settings.mediaKind === 'object')
  ) {
    assign('mediaKind', settings.mediaKind);
  }
  if (typeId !== 'media') return;
  if ('mediaInteractionLabel' in settings) {
    assign('mediaInteractionLabel', settings.mediaInteractionLabel ?? '');
  }
  if ('mediaObjectLabel' in settings) {
    assign('mediaObjectLabel', settings.mediaObjectLabel ?? '');
  }
  if ('mediaAutostart' in settings && typeof settings.mediaAutostart === 'boolean') {
    assign('mediaAutostart', settings.mediaAutostart);
  }
  if ('mediaLoop' in settings && typeof settings.mediaLoop === 'boolean') {
    assign('mediaLoop', settings.mediaLoop);
  }
  if ('mediaMinPlays' in settings) {
    assign('mediaMinPlays', settings.mediaMinPlays);
  }
  if ('mediaMaxPlays' in settings) {
    assign('mediaMaxPlays', settings.mediaMaxPlays);
  }
  if ('mediaCoords' in settings) {
    assign('mediaCoords', settings.mediaCoords ?? '');
  }
  if ('mediaWidth' in settings) {
    assign('mediaWidth', settings.mediaWidth);
  }
  if ('mediaHeight' in settings) {
    assign('mediaHeight', settings.mediaHeight);
  }
}

export function uploadControls(ctx: RailBuildContext): ControlPatch {
  if (ctx.typeId !== 'upload') return {};
  const { draft, setDraft } = ctx;
  return {
    uploadMaxFileSize: {
      value: draft.uploadMaxFileSize,
      onChange: (next) => setDraft({ uploadMaxFileSize: next }),
    },
    uploadFileTypes: {
      value: draft.uploadFileTypes ?? '',
      onChange: (next) => setDraft({ uploadFileTypes: next }),
    },
    uploadMultiple: {
      value: Boolean(draft.uploadMultiple),
      onChange: (next) => setDraft({ uploadMultiple: next }),
    },
  };
}

export function uploadSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    uploadMaxFileSize: draft.uploadMaxFileSize,
    uploadFileTypes: draft.uploadFileTypes ?? '',
    uploadMultiple: draft.uploadMultiple ?? false,
  };
}

export function applyUploadSettings(
  typeId: string,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (typeId !== 'upload') return;
  if ('uploadMaxFileSize' in settings) {
    assign('uploadMaxFileSize', settings.uploadMaxFileSize);
  }
  if ('uploadFileTypes' in settings) {
    assign('uploadFileTypes', settings.uploadFileTypes ?? '');
  }
  if ('uploadMultiple' in settings && typeof settings.uploadMultiple === 'boolean') {
    assign('uploadMultiple', settings.uploadMultiple);
  }
}

export function sliderControls(ctx: RailBuildContext): ControlPatch {
  if (ctx.typeId !== 'slider') return {};
  const { draft, setDraft } = ctx;
  return {
    sliderStepLabel: {
      value: Boolean(draft.sliderStepLabel),
      onChange: (next) => setDraft({ sliderStepLabel: next }),
    },
    sliderReverse: {
      value: Boolean(draft.sliderReverse),
      onChange: (next) => setDraft({ sliderReverse: next }),
    },
  };
}

export function sliderSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    sliderStepLabel: draft.sliderStepLabel ?? false,
    sliderReverse: draft.sliderReverse ?? false,
  };
}

export function applySliderSettings(
  typeId: string,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (typeId !== 'slider') return;
  if ('sliderStepLabel' in settings && typeof settings.sliderStepLabel === 'boolean') {
    assign('sliderStepLabel', settings.sliderStepLabel);
  }
  if ('sliderReverse' in settings && typeof settings.sliderReverse === 'boolean') {
    assign('sliderReverse', settings.sliderReverse);
  }
}

export function portableControls(ctx: RailBuildContext): ControlPatch {
  if (ctx.typeId !== 'portable_custom') return {};
  const { draft, setDraft } = ctx;
  return {
    portableModule: {
      value: draft.portableModule ?? '',
      onChange: (next) => setDraft({ portableModule: next }),
    },
    portableClassName: {
      value: draft.portableClassName ?? '',
      onChange: (next) => setDraft({ portableClassName: next }),
    },
    portableLabel: {
      value: draft.portableLabel ?? '',
      onChange: (next) => setDraft({ portableLabel: next }),
    },
    portableBaseType: {
      value: draft.portableBaseType ?? 'string',
      onChange: (next) => setDraft({ portableBaseType: next }),
    },
    portableCardinality: {
      value: draft.portableCardinality ?? 'single',
      options: (['single', 'multiple', 'ordered', 'record'] as const).map((value) => ({
        value,
        label: ctx.t(
          ({
            single: 'driver.rightRail.cardinalitySingle',
            multiple: 'driver.rightRail.cardinalityMultiple',
            ordered: 'driver.rightRail.cardinalityOrdered',
            record: 'driver.rightRail.cardinalityRecord',
          } as const)[value],
        ),
      })),
      onChange: (next) => setDraft({ portableCardinality: next as Draft['portableCardinality'] }),
    },
    portableModulesPrimaryConfiguration: {
      value: draft.portableModulesPrimaryConfiguration ?? '',
      onChange: (next) => setDraft({ portableModulesPrimaryConfiguration: next }),
    },
    portableModulesSecondaryConfiguration: {
      value: draft.portableModulesSecondaryConfiguration ?? '',
      onChange: (next) => setDraft({ portableModulesSecondaryConfiguration: next }),
    },
    portableInteractionModules: {
      value: draft.portableInteractionModules ?? [],
      onChange: (next) => setDraft({ portableInteractionModules: next }),
    },
  };
}

export function portableSettingsFrom(draft: RailDraft): DriverSettingsValues {
  return {
    portableModule: draft.portableModule ?? '',
    portableClassName: draft.portableClassName ?? '',
    portableLabel: draft.portableLabel ?? '',
    portableBaseType: draft.portableBaseType ?? 'string',
    portableCardinality: draft.portableCardinality ?? 'single',
    portableModulesPrimaryConfiguration: draft.portableModulesPrimaryConfiguration ?? '',
    portableModulesSecondaryConfiguration: draft.portableModulesSecondaryConfiguration ?? '',
    portableInteractionModules: draft.portableInteractionModules ?? [],
  };
}

export function applyPortableSettings(
  typeId: string,
  draft: RailDraft,
  settings: DriverSettingsValues,
  assign: SettingsAssign,
): void {
  if (typeId !== 'portable_custom') return;
  if ('portableModule' in settings) {
    assign('portableModule', settings.portableModule ?? '');
  }
  if ('portableClassName' in settings) {
    assign('portableClassName', settings.portableClassName ?? '');
  }
  if ('portableLabel' in settings) {
    assign('portableLabel', settings.portableLabel ?? '');
  }
  if ('portableBaseType' in settings) {
    assign('portableBaseType', settings.portableBaseType ?? 'string');
  }
  if (settings.portableCardinality !== undefined) {
    assign('portableCardinality', settings.portableCardinality);
  }
  if ('portableModulesPrimaryConfiguration' in settings) {
    assign(
      'portableModulesPrimaryConfiguration',
      settings.portableModulesPrimaryConfiguration ?? '',
    );
  }
  if ('portableModulesSecondaryConfiguration' in settings) {
    assign(
      'portableModulesSecondaryConfiguration',
      settings.portableModulesSecondaryConfiguration ?? '',
    );
  }
  if (
    settings.portableInteractionModules !== undefined &&
    settings.portableInteractionModules !== draft.portableInteractionModules
  ) {
    assign('portableInteractionModules', [...settings.portableInteractionModules]);
  }
}
