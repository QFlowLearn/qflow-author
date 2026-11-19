import { Console } from 'node:console';
import { Writable } from 'node:stream';

/** Capture the real Console's formatted diagnostic output without patching shared methods. */
export function diagnosticConsole() {
  let output = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk);
      done();
    },
  });
  return {
    console: new Console({
      stdout: sink,
      stderr: sink,
      inspectOptions: { depth: null, colors: false },
    }),
    text: () => output,
  };
}
