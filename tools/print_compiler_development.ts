import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Vite evaluates modules inside a request, where Typst's dummy callbacks cannot generate code.
 * Supply equivalent static callbacks in development; keep the pinned production artifact intact.
 */
export function printCompilerDevelopmentPlugin(): Plugin {
  const glue = resolve('vendor/typst/typst_ts_web_compiler.js');
  const callback = 'const ret = new Function(getStringFromWasm0(arg0, arg1));';
  const pathCallback =
    'const ret = new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));';
  return {
    name: 'qflow:print-compiler-development',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (id !== glue) return;
      if (!code.includes(callback) || !code.includes(pathCallback)) {
        throw Error('Typst startup callback changed; review the development adapter.');
      }
      return code.replace(
        pathCallback,
        `
          if (getStringFromWasm0(arg0, arg1) !== 'path' || getStringFromWasm0(arg2, arg3) !== 'return path') {
            throw Error('Unsupported Typst development path callback.');
          }
          const ret = function (path) { return path; };
        `,
      ).replace(
        callback,
        `
        const body = getStringFromWasm0(arg0, arg1);
        let ret;
        if (body === 'return 0') ret = function () { return 0; };
        else if (body === 'return true') ret = function () { return true; };
        else if (body === "throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')") {
          ret = function () { throw Error('Dummy AccessModel, please initialize compiler with withAccessModel()'); };
        }
        else if (body === "throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')") {
          ret = function () { throw Error('Dummy Registry, please initialize compiler with withPackageRegistry()'); };
        }
        else throw Error('Unsupported Typst development callback.');
      `,
      );
    },
  };
}
