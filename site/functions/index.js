import { chooseLocale } from '../negotiate.mjs';

/**
 * Cloudflare Pages serves this from the `site` project root (it is not copied into `dist`).
 * Static files cannot read Accept-Language, so `/` is the one dynamic route.
 * `dist/index.html` repeats the choice with the cookie and `navigator.language` when this function is absent.
 */
export function onRequest(context) {
  const url = new URL(context.request.url);
  const locale = chooseLocale({
    cookieHeader: context.request.headers.get('Cookie') || '',
    acceptLanguage: context.request.headers.get('Accept-Language') || '',
  });
  const target = new URL(`/${locale}/`, url.origin);
  target.search = url.search;
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      Vary: 'Accept-Language, Cookie',
      'Cache-Control': 'private, no-store',
    },
  });
}
