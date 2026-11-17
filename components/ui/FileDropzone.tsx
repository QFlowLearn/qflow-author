import Input from './Input.tsx';

type Props = {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly accept: string;
  readonly files: readonly File[];
  readonly multiple?: boolean;
  readonly disabled?: boolean;
  readonly onFiles: (files: File[]) => void;
  readonly focusSourceOnOpen?: boolean;
  readonly formatFileSize?: (bytes: number) => string;
};

/** Accessible file picker with an equivalent drag-and-drop target. */
export default function FileDropzone({
  id,
  label,
  help,
  accept,
  files,
  multiple = false,
  disabled = false,
  onFiles,
  focusSourceOnOpen = false,
  formatFileSize = formatBytes,
}: Props) {
  const helpId = `${id}-help`;
  const filesId = `${id}-files`;

  function receiveFiles(list: FileList | null): void {
    if (!list) return;
    const selected = Array.from(list);
    onFiles(multiple ? selected : selected.slice(0, 1));
  }

  return (
    <div class='space-y-2'>
      <label
        class={[
          'relative block min-h-32 rounded-lg border border-dashed border-base-300 bg-base-100 p-5',
          'transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-base-content/40',
        ].join(' ')}
        for={id}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!disabled) receiveFiles(event.dataTransfer?.files ?? null);
        }}
      >
        <span class='block text-sm font-medium text-base-content'>{label}</span>
        <span id={helpId} class='mt-1 block text-xs leading-5 text-base-content/60'>
          {help}
        </span>
        <Input
          id={id}
          type='file'
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={`${helpId}${files.length ? ` ${filesId}` : ''}`}
          class='absolute inset-0 h-full w-full cursor-pointer opacity-0'
          onInput={(event) => receiveFiles(event.currentTarget.files)}
          data-focus-ai-source={focusSourceOnOpen ? 'true' : undefined}
        />
      </label>
      {files.length > 0 && (
        <ul id={filesId} class='space-y-1 text-xs text-base-content/70'>
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>
              <span class='font-medium'>{file.name}</span> · {formatFileSize(file.size)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mebibytes = bytes / (1024 * 1024);
  return mebibytes >= 1
    ? `${Math.round(mebibytes * 10) / 10} MB`
    : `${Math.round(bytes / 102.4) / 10} KB`;
}
