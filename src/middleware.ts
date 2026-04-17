export { auth as middleware } from "@/lib/auth";

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico, sitemap.xml, robots.txt
         * - public assets
         * - ALL API routes (they handle their own auth or are internal-only)
         */
        "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)",
    ],
};
