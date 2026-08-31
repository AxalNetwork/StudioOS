const shouldStayNotFound = (pathname) => {
  if (pathname.startsWith('/api/') || pathname.startsWith('/assets/')) {
    return true;
  }

  const lastSegment = pathname.split('/').pop() || '';
  return lastSegment.includes('.');
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }

    const url = new URL(request.url);
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      shouldStayNotFound(url.pathname)
    ) {
      return response;
    }

    const indexUrl = new URL('/index.html', url);
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};