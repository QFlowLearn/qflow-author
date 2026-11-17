declare module 'virtual:qflow-assets' {
  export const edgeBuild: boolean;
  export const developmentOrigin: string | undefined;
  export const appAssets: {
    readonly styles: readonly string[];
    readonly preloads: readonly string[];
    readonly bootstrap: string;
  };
}
