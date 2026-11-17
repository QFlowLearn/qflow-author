type ResponseIdentifierDisclosureProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  class?: string;
};

export function ResponseIdentifierDisclosure(_props: ResponseIdentifierDisclosureProps) {
  // Response identifiers are auto-generated and intentionally not editable in the main UI.
  return null;
}
