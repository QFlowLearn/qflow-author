import type { QtiTranscodeProfileId } from '@longsightgroup/qti3-transcoder';

/** Direct-publish integration intentionally attached to an executable export contract. */
export type AssessmentExportDirectPublishCapability =
  | { readonly provider: 'canvas' }
  | null;

type TargetBase<
  Id extends string,
  Kind extends 'lms' | 'canonical' | 'standard',
  ContractId extends QtiTranscodeProfileId | 'qti3-conformant@1',
  DirectPublish extends AssessmentExportDirectPublishCapability,
> = {
  readonly id: Id;
  readonly label: string;
  readonly kind: Kind;
  readonly availability: 'selectable';
  readonly targetContractId: ContractId;
  readonly directPublish: DirectPublish;
};

type ProfileArchiveTarget<
  Id extends string,
  Kind extends 'lms' | 'standard',
  ProfileId extends QtiTranscodeProfileId,
  FilenameSuffix extends string,
  DirectPublish extends AssessmentExportDirectPublishCapability,
> = TargetBase<Id, Kind, ProfileId, DirectPublish> & {
  readonly compilation: {
    readonly _tag: 'ProfileArchive';
    readonly profileId: ProfileId;
  };
  readonly artifact: {
    readonly filenameSuffix: FilenameSuffix;
    readonly mediaType: 'application/zip';
  };
};

type ProfileFileTarget<
  Id extends string,
  Kind extends 'lms' | 'standard',
  ProfileId extends QtiTranscodeProfileId,
  Path extends string,
  FilenameSuffix extends string,
  MediaType extends string,
  DirectPublish extends AssessmentExportDirectPublishCapability,
> = TargetBase<Id, Kind, ProfileId, DirectPublish> & {
  readonly compilation: {
    readonly _tag: 'ProfileFile';
    readonly profileId: ProfileId;
    readonly path: Path;
  };
  readonly artifact: {
    readonly filenameSuffix: FilenameSuffix;
    readonly mediaType: MediaType;
  };
};

type CanonicalPackageTarget =
  & TargetBase<
    'qti3-conformant',
    'canonical',
    'qti3-conformant@1',
    null
  >
  & {
    readonly compilation: { readonly _tag: 'CanonicalPackage' };
    readonly artifact: {
      readonly filenameSuffix: 'qti3.zip';
      readonly mediaType: 'application/zip';
    };
  };

type ExecutableTargetDefinition =
  | ProfileArchiveTarget<
    string,
    'lms' | 'standard',
    QtiTranscodeProfileId,
    string,
    AssessmentExportDirectPublishCapability
  >
  | ProfileFileTarget<
    string,
    'lms' | 'standard',
    QtiTranscodeProfileId,
    string,
    string,
    string,
    AssessmentExportDirectPublishCapability
  >
  | CanonicalPackageTarget;

function profileArchiveTarget<
  const Id extends string,
  const Kind extends 'lms' | 'standard',
  const ProfileId extends QtiTranscodeProfileId,
  const FilenameSuffix extends string,
  const DirectPublish extends AssessmentExportDirectPublishCapability,
>(input: {
  readonly id: Id;
  readonly label: string;
  readonly kind: Kind;
  readonly profileId: ProfileId;
  readonly filenameSuffix: FilenameSuffix;
  readonly directPublish: DirectPublish;
}): ProfileArchiveTarget<Id, Kind, ProfileId, FilenameSuffix, DirectPublish> {
  return {
    id: input.id,
    label: input.label,
    kind: input.kind,
    availability: 'selectable',
    targetContractId: input.profileId,
    directPublish: input.directPublish,
    compilation: {
      _tag: 'ProfileArchive',
      profileId: input.profileId,
    },
    artifact: {
      filenameSuffix: input.filenameSuffix,
      mediaType: 'application/zip',
    },
  };
}

function profileFileTarget<
  const Id extends string,
  const Kind extends 'lms' | 'standard',
  const ProfileId extends QtiTranscodeProfileId,
  const Path extends string,
  const FilenameSuffix extends string,
  const MediaType extends string,
  const DirectPublish extends AssessmentExportDirectPublishCapability,
>(input: {
  readonly id: Id;
  readonly label: string;
  readonly kind: Kind;
  readonly profileId: ProfileId;
  readonly path: Path;
  readonly filenameSuffix: FilenameSuffix;
  readonly mediaType: MediaType;
  readonly directPublish: DirectPublish;
}): ProfileFileTarget<Id, Kind, ProfileId, Path, FilenameSuffix, MediaType, DirectPublish> {
  return {
    id: input.id,
    label: input.label,
    kind: input.kind,
    availability: 'selectable',
    targetContractId: input.profileId,
    directPublish: input.directPublish,
    compilation: {
      _tag: 'ProfileFile',
      profileId: input.profileId,
      path: input.path,
    },
    artifact: {
      filenameSuffix: input.filenameSuffix,
      mediaType: input.mediaType,
    },
  };
}

function defineAssessmentExportTargets<
  const Targets extends readonly ExecutableTargetDefinition[],
>(...targets: Targets): Targets {
  const targetIds = new Set<string>();
  for (const target of targets) {
    if (targetIds.has(target.id)) {
      throw new TypeError(`Duplicate assessment export target ID: ${target.id}`);
    }
    targetIds.add(target.id);
  }
  return targets;
}

const SELECTABLE_TARGETS = defineAssessmentExportTargets(
  profileArchiveTarget({
    id: 'canvas-classic',
    label: 'Canvas Classic Quizzes',
    kind: 'lms',
    profileId: 'canvas-classic-quizzes@1',
    filenameSuffix: 'canvas-classic.zip',
    directPublish: { provider: 'canvas' },
  }),
  profileArchiveTarget({
    id: 'canvas-new-quizzes',
    label: 'Canvas New Quizzes',
    kind: 'lms',
    profileId: 'canvas-new-quizzes@1',
    filenameSuffix: 'canvas-new-quizzes.zip',
    directPublish: { provider: 'canvas' },
  }),
  profileArchiveTarget({
    id: 'blackboard-question-banks',
    label: 'Blackboard Learn question banks',
    kind: 'lms',
    profileId: 'blackboard-question-banks@1',
    filenameSuffix: 'blackboard-question-banks.zip',
    directPublish: null,
  }),
  profileArchiveTarget({
    id: 'brightspace-course-import',
    label: 'Brightspace course import',
    kind: 'lms',
    profileId: 'brightspace-course-import@1',
    filenameSuffix: 'brightspace-course-import.zip',
    directPublish: null,
  }),
  profileFileTarget({
    id: 'moodle',
    label: 'Moodle',
    kind: 'lms',
    profileId: 'moodle-xml@1',
    path: 'moodle_questions.xml',
    filenameSuffix: 'moodle.xml',
    mediaType: 'application/xml',
    directPublish: null,
  }),
  {
    id: 'qti3-conformant',
    label: 'QTI 3.0 assessment package',
    kind: 'canonical',
    availability: 'selectable',
    targetContractId: 'qti3-conformant@1',
    directPublish: null,
    compilation: { _tag: 'CanonicalPackage' },
    artifact: {
      filenameSuffix: 'qti3.zip',
      mediaType: 'application/zip',
    },
  },
  profileArchiveTarget({
    id: 'qti22-standard',
    label: 'QTI 2.2 assessment package',
    kind: 'standard',
    profileId: 'qti22-standard@1',
    filenameSuffix: 'qti22.zip',
    directPublish: null,
  }),
  profileArchiveTarget({
    id: 'qti21-standard',
    label: 'QTI 2.1 assessment package',
    kind: 'standard',
    profileId: 'qti21-standard@1',
    filenameSuffix: 'qti21.zip',
    directPublish: null,
  }),
  profileArchiveTarget({
    id: 'qti12-standard',
    label: 'QTI 1.2 assessment package',
    kind: 'standard',
    profileId: 'qti12-standard@1',
    filenameSuffix: 'qti12.zip',
    directPublish: null,
  }),
);

/** One executable export target whose compilation and artifact contracts cannot disagree. */
export type SelectableAssessmentExportTarget = (typeof SELECTABLE_TARGETS)[number];

/** Exact export target identifier that can execute against the pinned qti3 release. */
export type SelectableAssessmentExportTargetId = SelectableAssessmentExportTarget['id'];

/** Result of parsing an untrusted export target identifier. */
export type AssessmentExportTargetResolution =
  | {
    readonly ok: true;
    readonly target: SelectableAssessmentExportTarget;
  }
  | {
    readonly ok: false;
    readonly error: {
      readonly _tag: 'DestinationNotRegistered';
      readonly requestedTargetId: string | null;
    };
  };

/** Lists exact, executable target contracts. */
export function listSelectableAssessmentExportTargets(): readonly SelectableAssessmentExportTarget[] {
  return SELECTABLE_TARGETS;
}

/** Returns the exact qti3 profile for a transcoded target, or null for canonical QTI 3. */
export function assessmentExportTranscodeProfileId(
  target: SelectableAssessmentExportTarget,
): QtiTranscodeProfileId | null {
  return target.compilation._tag === 'CanonicalPackage' ? null : target.compilation.profileId;
}

/** Resolves one explicitly named target without aliases, detection, defaults, or fallback. */
export function resolveAssessmentExportTarget(
  requestedTargetId: string | null,
): AssessmentExportTargetResolution {
  const target = SELECTABLE_TARGETS.find((candidate) => candidate.id === requestedTargetId);
  if (target) {
    return { ok: true, target };
  }
  return {
    ok: false,
    error: {
      _tag: 'DestinationNotRegistered',
      requestedTargetId,
    },
  };
}

/** Paper compilation is a distinct artifact contract, never a QTI profile or ZIP package. */
export const PRINT_PACK_TARGET = {
  id: 'printable-pack',
  kind: 'paper',
  label: 'Printable assessment pack',
  availability: 'selectable',
  targetContractId: 'qflow-paper-v1',
  compilation: { _tag: 'PrintablePack' },
  artifacts: ['student-pdf', 'marking-pdf', 'manifest-json'],
} as const;

/** Builder destinations include executable QTI targets and the separately compiled paper pair. */
export function listAssessmentExportDestinations() {
  return [...listSelectableAssessmentExportTargets(), PRINT_PACK_TARGET];
}
