import { reportUiError } from '../../lib/client/ui_event.ts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PDFDocumentProxy, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import Button from '../../components/ui/Button.tsx';
import { useI18n } from '../../lib/i18n/context.tsx';

type PdfModule = typeof import('pdfjs-dist');
// Vite removes this browser-only module from the Worker graph at build time.
const pdfJs = import.meta.env.SSR ? null : import('pdfjs-dist').then((module) => {
  module.GlobalWorkerOptions.workerSrc = workerUrl;
  return module;
});

/** Render one authorized retained PDF page at a time, with selectable text and bounded canvases. */
export default function PrintPdfPreview(
  { url, onReviewed }: { readonly url: string; readonly onReviewed: () => void },
) {
  const i18n = useI18n(),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(false),
    [renderedPage, setRenderedPage] = useState<
      {
        readonly document: PDFDocumentProxy;
        readonly page: number;
      } | null
    >(null);
  const ready = renderedPage?.document === document && renderedPage?.page === page;
  const visited = useRef(new Set<number>());
  useEffect(() => {
    const controller = new AbortController();
    let task: ReturnType<PdfModule['getDocument']> | undefined;
    setDocument(null);
    setPage(1);
    setRenderedPage(null);
    setError(false);
    visited.current.clear();
    fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(
      async (response) => {
        if (!response.ok) throw Error('preview_failed');
        const module = await pdfJs;
        if (!module) throw Error('PDF preview requires a browser.');
        task = module.getDocument({
          data: new Uint8Array(await response.arrayBuffer()),
          disableFontFace: true,
          useWorkerFetch: false,
        });
        const loaded = await task.promise;
        if (controller.signal.aborted) return;
        setDocument(loaded);
      },
    ).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => {
      controller.abort();
      task?.destroy().catch(reportUiError);
    };
  }, [url]);
  useEffect(() => {
    if (!document || !canvas.current || !text.current) return;
    const target = canvas.current, layer = text.current;
    let cancelled = false,
      rendering: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined,
      textLayer: TextLayer | undefined;
    setRenderedPage(null);
    document.getPage(page).then(async (pdfPage) => {
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: 1.2 });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      layer.replaceChildren();
      layer.style.setProperty('--scale-factor', '1.2');
      rendering = pdfPage.render({ canvas: target, viewport });
      await rendering.promise;
      if (cancelled) return;
      const module = await pdfJs;
      if (!module || cancelled) return;
      textLayer = new module.TextLayer({
        textContentSource: await pdfPage.getTextContent(),
        container: layer,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;
      visited.current.add(page);
      setRenderedPage({ document, page });
      if (visited.current.size === document.numPages) onReviewed();
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      rendering?.cancel();
      textLayer?.cancel();
    };
  }, [document, page]);
  return (
    <div class='space-y-3'>
      <nav
        class='flex flex-wrap items-center justify-between gap-3'
        aria-label={i18n.t('print.pages')}
      >
        <Button
          type='button'
          size='sm'
          disabled={!document || page <= 1 || !ready}
          onClick={() => setPage(page - 1)}
        >
          {i18n.t('print.previous')}
        </Button>
        <span role='status'>
          {document
            ? i18n.t('print.pageOf', { page, total: document.numPages })
            : i18n.t('print.loading')}
        </span>
        <Button
          type='button'
          size='sm'
          disabled={!document || page >= document.numPages || !ready}
          onClick={() => setPage(page + 1)}
        >
          {i18n.t('print.next')}
        </Button>
      </nav>
      {error && <p role='alert' class='text-error'>{i18n.t('print.previewFailed')}</p>}
      <div class='overflow-auto border border-base-300 bg-base-200 p-2' aria-busy={!ready}>
        <div class='relative mx-auto w-fit bg-white'>
          <canvas
            ref={canvas}
            class='block max-w-none'
            aria-label={i18n.t('print.pageOf', { page, total: document?.numPages ?? 0 })}
          />
          <div ref={text} class='textLayer' />
        </div>
      </div>
    </div>
  );
}
