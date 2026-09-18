import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cheap gate only: it checks that an admin cookie exists so unauthenticated
 * visitors get the login page instead of a flashing empty dashboard. Real
 * authorisation happens in every /api/admin route against the database.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/admin/login') return NextResponse.next();

  if (pathname.startsWith('/admin') || pathname.startsWith('/booth')) {
    if (!req.cookies.get('toap_as')) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*', '/booth/:path*'] };
