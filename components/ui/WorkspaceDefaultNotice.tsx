/** Quiet policy explanation beside authoring preference controls. */
export default function WorkspaceDefaultNotice({ text }: { readonly text: string }) {
  return <p class='text-sm text-base-content/70'>{text}</p>;
}
