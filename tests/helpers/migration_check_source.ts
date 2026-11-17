/** Real Respondus source with cross-page missing answers, an invalid key and overlapping media. */
export function migrationCheckSource() {
  const text = Array.from(
    { length: 121 },
    (_, i) =>
      `${i + 1}. Review question ${i + 1}?${i === 120 ? ' [img: missing.png]' : ''}\n${
        i < 60 ? '*' : ''
      }a. Yes\nb. No\n`,
  ).join('\n') + '\nAnswers:\n120. C\n';
  return {
    filename: 'answer-media-checks.txt',
    mime: 'text/plain',
    bytes: new TextEncoder().encode(text),
  };
}
