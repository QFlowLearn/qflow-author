# Migration batch fixtures

This public synthetic corpus covers batch workflow failures without using customer or publisher
content.

- `qti21-choice.xml` is a valid source that must reach review.
- `examview-choice.xml` is a second valid format in the same batch.
- `unsupported-package.bin` must fail its first permanent analysis attempt without stopping the
  valid sources.
- The service test interrupts the second object write, replays the same command, and verifies that
  source preservation resumes without publishing a partial batch.
- The service test replays a completed submission and verifies that it returns the original batch
  and run IDs.
