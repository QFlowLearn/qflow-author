import { authorizedCanvasFetch } from './canvas_connection_fixture.ts';

export function successfulCanvasFetch(
  calls: string[],
  inspectCreateForm?: (form: FormData) => void,
): typeof fetch {
  return authorizedCanvasFetch('test-token', (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === 'https://uploads.example.net/success') {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://canvas.example.edu/api/v1/files/1/create_success' },
        }),
      );
    }
    if (url.endsWith('/create_success')) return Promise.resolve(Response.json({ id: 1 }));
    if (url.endsWith('/api/v1/progress/42')) {
      return Promise.resolve(Response.json({ workflow_state: 'completed', completion: 100 }));
    }
    if (url.endsWith('/content_migrations/42')) {
      return Promise.resolve(Response.json(canvasMigration(42, 'importing', null)));
    }
    if (url.endsWith('/content_migrations') && init?.method === 'POST') {
      if (init.body instanceof FormData) inspectCreateForm?.(init.body);
      return Promise.resolve(Response.json(canvasMigration(42, 'created', {
        upload_url: 'https://uploads.example.net/success',
        upload_params: { policy: 'success' },
      })));
    }
    throw new Error(`Unexpected Canvas request: ${init?.method ?? 'GET'} ${url}`);
  });
}

export function recoverableCanvasFetch(): {
  readonly fetch: typeof fetch;
  readonly createCount: () => number;
  readonly refreshCount: () => number;
} {
  let createCount = 0;
  let refreshCount = 0;
  let migrationReadCount = 0;
  const fetchImpl: typeof fetch = authorizedCanvasFetch('test-token', (input, init) => {
    const url = String(input);
    if (url === 'https://uploads.example.net/first') {
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    if (url === 'https://uploads.example.net/second') {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://canvas.example.edu/api/v1/files/2/create_success' },
        }),
      );
    }
    if (url.endsWith('/create_success')) return Promise.resolve(Response.json({ id: 2 }));
    if (url.endsWith('/api/v1/progress/77')) {
      return Promise.resolve(Response.json({ workflow_state: 'completed', completion: 100 }));
    }
    if (url.endsWith('/content_migrations') && init?.method === 'POST') {
      createCount += 1;
      return Promise.resolve(Response.json(canvasMigration(77, 'created', {
        upload_url: 'https://uploads.example.net/first',
        upload_params: { policy: 'first' },
      })));
    }
    if (url.endsWith('/content_migrations/77') && init?.method === 'PUT') {
      refreshCount += 1;
      return Promise.resolve(Response.json(canvasMigration(77, 'created', {
        upload_url: 'https://uploads.example.net/second',
        upload_params: { policy: 'second' },
      })));
    }
    if (url.endsWith('/content_migrations/77')) {
      migrationReadCount += 1;
      return Promise.resolve(Response.json(canvasMigration(
        77,
        migrationReadCount === 1 ? 'created' : 'importing',
        null,
      )));
    }
    throw new Error(`Unexpected Canvas recovery request: ${init?.method ?? 'GET'} ${url}`);
  });
  return { fetch: fetchImpl, createCount: () => createCount, refreshCount: () => refreshCount };
}

export function canvasMigration(
  id: number,
  workflowState: string,
  preAttachment: Record<string, unknown> | null,
) {
  return {
    id,
    workflow_state: workflowState,
    progress_url: `https://canvas.example.edu/api/v1/progress/${id}`,
    ...(preAttachment ? { pre_attachment: preAttachment } : {}),
  };
}
