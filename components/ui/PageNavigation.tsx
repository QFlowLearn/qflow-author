/** Page destinations rendered as navigation, with a distinct current-page marker. */
export default function PageNavigation({ label, links }: {
  readonly label: string;
  readonly links: readonly {
    readonly href: string;
    readonly label: string;
    readonly current: boolean;
  }[];
}) {
  return (
    <nav aria-label={label}>
      <ul class='flex flex-wrap gap-x-2 gap-y-1'>
        {links.map((link) => (
          <li key={link.href} class='min-w-0 max-w-full'>
            <a
              href={link.href}
              aria-current={link.current ? 'page' : undefined}
              class={`block min-h-11 rounded-t px-3 py-2.5 text-sm leading-5 break-words border-b-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${
                link.current
                  ? 'border-secondary bg-base-200 text-secondary font-semibold'
                  : 'border-transparent text-base-content hover:bg-base-200 hover:border-base-300'
              }`}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
