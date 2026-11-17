import { defineHttpRoute } from '../../route.ts';

/** Shared route contract preserving the existing server-rendered page behavior. */
export const homePageRoute = defineHttpRoute('/', { GET: handleGET, HEAD: handleGET });

export default function HomeRedirect() {
  return null;
}

function handleGET() {
  return new Response(null, {
    status: 302,
    headers: { location: '/login' },
  });
}
