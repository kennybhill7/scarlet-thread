import "server-only";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { isAllowedEmail } from "@/lib/auth/allowlist";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [Google],
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: {
    strategy: "database",
  },
  callbacks: {
    signIn({ profile, user }) {
      // This is a private, single-user journal. Missing configuration denies all.
      return (
        profile?.email_verified === true &&
        isAllowedEmail(profile.email ?? user.email)
      );
    },
    authorized({ auth: session }) {
      return Boolean(
        session?.user?.id && isAllowedEmail(session.user.email),
      );
    },
    session({ session, user }) {
      if (session.user) {
        // API routes check this ID. Clearing it makes an existing database
        // session fail closed if the configured owner email ever changes.
        session.user.id = isAllowedEmail(session.user.email) ? user.id : "";
      }
      return session;
    },
  },
});
