import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

/**
 * Dev-mode credentials provider: allows login by email without Google OAuth.
 * Active only when AUTH_GOOGLE_ID is not configured.
 */
const devCredentials = Credentials({
    id: "dev-login",
    name: "Dev Login",
    credentials: {
        email: { label: "Email", type: "email" },
    },
    async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        if (!email) return null;
        return {
            id: email,
            email,
            name: email.split("@")[0],
            image: null,
        };
    },
});

const providers = process.env.AUTH_GOOGLE_ID
    ? [Google]
    : [devCredentials];

/**
 * Check if an email is allowed to sign in.
 * Reads the allowed_users.json file at runtime using globalThis tricks
 * to avoid Turbopack Edge analysis. The signIn callback runs in Node.js
 * runtime, not Edge, so this is safe at runtime.
 */
function checkAllowedEmail(email: string): { allowed: boolean; role: string } {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs") as typeof import("fs");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require("path") as typeof import("path");

        const filePath = path.resolve("data", "allowed_users.json");

        if (!fs.existsSync(filePath)) {
            // Seed with the admin
            const adminEmail = process.env.ADMIN_EMAIL || "evsinantongpt@gmail.com";
            fs.mkdirSync(path.resolve("data"), { recursive: true });
            const seed = [
                { email: adminEmail, role: "admin", name: "Admin", created_at: new Date().toISOString() },
            ];
            fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf-8");

            if (email.toLowerCase() === adminEmail.toLowerCase()) {
                return { allowed: true, role: "admin" };
            }
            return { allowed: false, role: "user" };
        }

        const raw = fs.readFileSync(filePath, "utf-8");
        const users = JSON.parse(raw) as Array<{
            email: string;
            role: string;
            last_login?: string;
        }>;
        const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
        if (!user) return { allowed: false, role: "user" };

        // Update last_login
        user.last_login = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");

        return { allowed: true, role: user.role };
    } catch {
        // If file check fails, allow login to prevent lockout
        return { allowed: true, role: "user" };
    }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers,
    pages: {
        signIn: "/login",
    },
    session: {
        strategy: "jwt",
    },
    callbacks: {
        signIn({ user, account }) {
            if (account?.provider === "dev-login") return true;

            const email = user.email;
            if (!email) return false;

            const { allowed } = checkAllowedEmail(email);
            return allowed;
        },

        jwt({ token, user }) {
            if (user?.email) {
                const { role } = checkAllowedEmail(user.email);
                token.role = role;
            }
            return token;
        },

        session({ session, token }) {
            if (session.user) {
                (session.user as Record<string, unknown>).role = token.role || "user";
            }
            return session;
        },

        authorized({ auth: session, request }) {
            const isLoggedIn = !!session?.user;
            const isLoginPage =
                request.nextUrl.pathname.startsWith("/login");
            const isApiAuth =
                request.nextUrl.pathname.startsWith("/api/auth");
            const isApiTelegram =
                request.nextUrl.pathname.startsWith("/api/telegram");
            const isApiIndexer =
                request.nextUrl.pathname.startsWith("/api/indexer");
            const isApiDebug =
                request.nextUrl.pathname.startsWith("/api/debug");

            if (isApiAuth || isApiTelegram || isApiIndexer || isApiDebug) return true;

            if (isLoginPage && isLoggedIn) {
                return Response.redirect(
                    new URL("/", request.nextUrl),
                );
            }

            if (isLoginPage) return true;

            return isLoggedIn;
        },
    },
});
