import { expect, test as testCase } from 'vitest';

import { catalogForLocale } from '../lib/i18n/catalogs.ts';
import { createI18n } from '../lib/i18n/messages.ts';
import { assetUploadErrorMessage } from '../components/ui/AssetUpload.tsx';

import {
  classifyUploadHint,
  inspectUpload,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MEBIBYTES,
  UPLOAD_POLICIES,
  uploadLimitTextForMediaKind,
  validateUploadHint,
  validateUploadHintStructured,
} from '../lib/upload_policy.ts';

testCase('upload hints use one canonical extension vocabulary', () => {
  expect(classifyUploadHint('lecture.m4a', '')).toStrictEqual('audio');
  expect(classifyUploadHint('recording.flac', null)).toStrictEqual('audio');
  expect(classifyUploadHint('clip.ogv', '')).toStrictEqual('video');
  expect(classifyUploadHint('diagram.svg', '')).toStrictEqual('image');
});

testCase('upload hint validation enforces media-kind and size policy', () => {
  expect(validateUploadHint({ name: 'lecture.m4a', type: '', size: 512 }, 'audio')).toStrictEqual(
    null,
  );
  expect(validateUploadHint({ name: 'lecture.m4a', type: '', size: 512 }, 'video')).toStrictEqual(
    'Choose a video file.',
  );
  expect(validateUploadHint({ name: 'empty.png', type: 'image/png', size: 0 }, 'object'))
    .toStrictEqual('Choose a file that is not empty.');
  expect(MAX_UPLOAD_MEBIBYTES).toStrictEqual(24);
  expect(validateUploadHint({ name: 'lecture.m4a', type: '', size: MAX_UPLOAD_BYTES + 1 }, 'audio'))
    .toStrictEqual('Audio files must be 24 MB or smaller.');
  expect(uploadLimitTextForMediaKind('video')).toStrictEqual('Maximum file size: 24 MB.');
});

testCase('structured upload hints distinguish image-only and media policies', () => {
  expect(
    validateUploadHintStructured({ name: 'a.pdf', type: 'application/pdf', size: 1 }, 'image')
      ?.code,
  ).toStrictEqual('wrong-kind');
  expect(validateUploadHintStructured({ name: 'a.png', type: 'image/png', size: 1 }, 'image'))
    .toStrictEqual(null);
  expect(validateUploadHintStructured({ name: 'a.png', type: 'image/png', size: 0 }, 'image')?.code)
    .toStrictEqual('empty');
  expect(
    validateUploadHintStructured(
      { name: 'a.png', type: 'image/png', size: MAX_UPLOAD_BYTES + 1 },
      'image',
    )?.code,
  ).toStrictEqual('too-large');
  expect(
    validateUploadHintStructured({ name: 'a.pdf', type: 'application/pdf', size: 1 }, 'object'),
  ).toStrictEqual(null);
  expect(
    validateUploadHintStructured({ name: 'a.mp3', type: 'audio/mpeg', size: 1 }, 'video')?.code,
  ).toStrictEqual('wrong-kind');
});

testCase('asset upload errors map closed reasons through real localized catalogs', () => {
  const i18n = (locale: 'en-US' | 'es-ES' | 'es-419') =>
    createI18n(locale, catalogForLocale(locale));
  const us = i18n('en-US');
  expect(assetUploadErrorMessage(us, { code: 'processing-failed' })).toStrictEqual(
    us.t('editor.uploadFailed'),
  );
  expect(assetUploadErrorMessage(us, { code: 'empty' })).toStrictEqual(us.t('editor.uploadEmpty'));
  for (const expected of ['image', 'audio', 'video', 'object', 'captions'] as const) {
    const result = assetUploadErrorMessage(us, { code: 'wrong-kind', expected });
    expect(result).toStrictEqual(us.t('editor.uploadWrongKind', {
      kind: expected === 'object'
        ? us.t('editor.mediaKindImagePdf')
        : us.t(`editor.mediaKind${expected[0].toUpperCase()}${expected.slice(1)}`),
    }));
  }
  for (const kind of ['image', 'pdf', 'audio', 'video', 'captions'] as const) {
    expect(assetUploadErrorMessage(us, { code: 'too-large', kind, maxMebibytes: 8 })).toStrictEqual(
      us.t('editor.uploadTooLarge', {
        kind: us.t(`editor.mediaKind${kind[0].toUpperCase()}${kind.slice(1)}`),
        max: 8,
      }),
    );
  }
  const es = i18n('es-ES');
  const latam = i18n('es-419');
  expect(assetUploadErrorMessage(es, { code: 'wrong-kind', expected: 'image' })).toStrictEqual(
    'Elige un archivo de tipo imagen.',
  );
  expect(assetUploadErrorMessage(es, { code: 'wrong-kind', expected: 'pdf' })).toStrictEqual(
    'Elige un archivo de tipo PDF.',
  );
  expect(assetUploadErrorMessage(es, { code: 'wrong-kind', expected: 'video' })).toStrictEqual(
    'Elige un archivo de tipo vídeo.',
  );
  expect(assetUploadErrorMessage(latam, { code: 'wrong-kind', expected: 'image' })).toStrictEqual(
    'Selecciona un archivo de tipo imagen.',
  );
  expect(assetUploadErrorMessage(latam, { code: 'wrong-kind', expected: 'audio' })).toStrictEqual(
    'Selecciona un archivo de tipo audio.',
  );
  for (
    const hostile of [
      null,
      { code: 'evil', expected: '<script>' },
      { code: 'wrong-kind', expected: 'HOSTILE' },
      { code: 'too-large', kind: 'HOSTILE', maxMebibytes: 2 },
      { code: 'too-large', kind: 'image', maxMebibytes: Number.NaN },
      { code: 'too-large', kind: 'image', maxMebibytes: -1 },
      { code: 'empty', message: 'SECRET' },
    ]
  ) {
    const result = assetUploadErrorMessage(us, hostile);
    expect(result).toStrictEqual(us.t('editor.uploadFailed'));
    if (typeof hostile === 'object' && hostile && 'expected' in hostile) {
      if (result.includes(String(hostile.expected))) {
        expect.unreachable('Expected !result.includes(String(hostile.expected))');
      }
    }
  }
});

testCase('upload inspection derives canonical MIME from bytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(inspectUpload(png, { name: 'image.png', claimedType: 'image/png' })).toStrictEqual({
    _tag: 'valid',
    upload: { kind: 'image', mimeType: 'image/png' },
  });

  const m4a = new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x18,
    0x66,
    0x74,
    0x79,
    0x70,
    0x4d,
    0x34,
    0x41,
    0x20,
  ]);
  expect(inspectUpload(m4a, { name: 'lecture.m4a', claimedType: '' })).toStrictEqual({
    _tag: 'valid',
    upload: { kind: 'audio', mimeType: 'audio/mp4' },
  });
});

testCase('upload inspection rejects spoofed and conflicting media metadata', () => {
  expect(
    inspectUpload(new Uint8Array([0x4d, 0x5a]), {
      name: 'payload.exe',
      claimedType: 'image/png',
    })._tag,
  ).toStrictEqual('invalid');

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(inspectUpload(png, { name: 'image.png', claimedType: 'video/mp4' })._tag).toStrictEqual(
    'invalid',
  );
  expect(inspectUpload(png, { name: 'image.mp4', claimedType: 'image/png' })._tag).toStrictEqual(
    'invalid',
  );
});

testCase('caption uploads recognize UTF-8 WebVTT envelopes without changing the bytes', () => {
  const encoder = new TextEncoder();
  const body = '00:00.000 --> 00:01.500\n<v Speaker>Olá, 你好 👋</v>\n';
  for (const lineEnd of ['\n', '\r\n', '\r']) {
    for (const prefix of ['', '\uFEFF']) {
      for (const header of ['WEBVTT', 'WEBVTT Lecture captions', 'WEBVTT\tLecture']) {
        const bytes = encoder.encode(`${prefix}${header}\n\n${body}`.replaceAll('\n', lineEnd));
        const before = bytes.slice();
        expect(inspectUpload(bytes, { name: 'CAPTIONS.VTT', claimedType: '' })).toStrictEqual({
          _tag: 'valid',
          upload: { kind: 'captions', mimeType: 'text/vtt' },
        });
        expect(bytes).toStrictEqual(before);
      }
    }
  }
  expect(
    inspectUpload(encoder.encode('WEBVTT\n\n'), {
      name: 'empty-cues.vtt',
      claimedType: 'Text/Vtt; charset=utf-8',
    })._tag,
  ).toStrictEqual('valid');
  for (const type of ['', 'text/vtt', 'application/octet-stream', 'text/plain']) {
    expect(classifyUploadHint('captions.vtt', type)).toStrictEqual('captions');
    expect(validateUploadHintStructured({ name: 'captions.vtt', type, size: 20 }, 'captions'))
      .toStrictEqual(null);
  }
  expect(validateUploadHintStructured({ name: 'x.png', type: 'image/png', size: 20 }, 'captions'))
    .toStrictEqual({
      code: 'wrong-kind',
      expected: 'captions',
    });
  expect(validateUploadHintStructured({ name: 'x.vtt', size: 0 }, 'captions')).toStrictEqual({
    code: 'empty',
  });
  expect(validateUploadHintStructured(
    { name: 'x.vtt', size: UPLOAD_POLICIES.captions.maxBytes + 1 },
    'captions',
  )).toStrictEqual({
    code: 'too-large',
    kind: 'captions',
    maxMebibytes: 1,
  });
  expect(validateUploadHintStructured(
    { name: 'x.vtt', size: UPLOAD_POLICIES.captions.maxBytes },
    'captions',
  )).toStrictEqual(null);
  // The multi-byte character spans the inspection chunk boundary.
  const largeCue = encoder.encode(`WEBVTT\n\n${' '.repeat(65527)}你好`);
  expect(inspectUpload(largeCue, { name: 'large.vtt' })._tag).toStrictEqual('valid');
  for (const locale of ['en-US', 'en-GB', 'es-ES', 'es-419', 'sv-SE'] as const) {
    const i18n = createI18n(locale, catalogForLocale(locale));
    expect(assetUploadErrorMessage(i18n, { code: 'wrong-kind', expected: 'captions' }))
      .toStrictEqual(
        i18n.t('editor.uploadWrongKind', { kind: i18n.t('editor.mediaKindCaptions') }),
      );
    expect(assetUploadErrorMessage(i18n, { code: 'too-large', kind: 'captions', maxMebibytes: 1 }))
      .toStrictEqual(
        i18n.t('editor.uploadTooLarge', { kind: i18n.t('editor.mediaKindCaptions'), max: 1 }),
      );
  }
  for (const kind of ['image', 'audio', 'video', 'object'] as const) {
    expect(validateUploadHintStructured({ name: 'x.vtt', size: 20 }, kind)?.code).toStrictEqual(
      'wrong-kind',
    );
  }
});

testCase(
  'caption upload inspection rejects misleading headers, invalid UTF-8 and conflicting metadata',
  () => {
    const encoder = new TextEncoder();
    for (
      const text of [
        'WEBVTT',
        'WEBVTT\n',
        'WEBVTT\r\n',
        'WEBVTT\n00:00.000 --> 00:01.000\nHello',
        ' WEBVTT\n\n',
        'webvtt\n\n',
        'WEBVTT-extra\n\n',
        '<script>WEBVTT</script>',
        '1\n00:00:00,000 --> 00:00:01,000\nSubRip',
        'WEBVTT\n\n\u0000',
      ]
    ) {
      expect(inspectUpload(encoder.encode(text), { name: 'x.vtt', claimedType: 'text/vtt' }))
        .toStrictEqual({
          _tag: 'invalid',
          code: 'content_unsupported',
        });
    }
    const bytes = encoder.encode('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n');
    const invalidUtf8 = new Uint8Array([...bytes, 0xc0, 0xaf]);
    expect(inspectUpload(invalidUtf8, { name: 'x.vtt' })).toStrictEqual({
      _tag: 'invalid',
      code: 'content_unsupported',
    });
    const truncatedUtf8 = new Uint8Array([...bytes, 0xe4, 0xbd]);
    expect(inspectUpload(truncatedUtf8, { name: 'x.vtt' })).toStrictEqual({
      _tag: 'invalid',
      code: 'content_unsupported',
    });
    expect(inspectUpload(bytes, { name: 'x.vtt', claimedType: 'video/mp4' })).toStrictEqual({
      _tag: 'invalid',
      code: 'content_type_mismatch',
    });
    expect(inspectUpload(bytes, { name: 'x.mp4', claimedType: 'text/vtt' })).toStrictEqual({
      _tag: 'invalid',
      code: 'filename_extension_mismatch',
    });
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(inspectUpload(png, { name: 'x.vtt', claimedType: 'text/vtt' })).toStrictEqual({
      _tag: 'invalid',
      code: 'content_type_mismatch',
    });
  },
);
