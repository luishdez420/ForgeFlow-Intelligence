import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowedWorkspaceIdentity } from "./auth-policy";

const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers:
    googleClientId && googleClientSecret
      ? [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]
      : [],
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    async signIn({ profile }) {
      return isAllowedWorkspaceIdentity(
        profile?.email,
        profile?.email_verified === true,
        process.env.GOOGLE_WORKSPACE_DOMAIN,
        process.env.GOOGLE_ALLOWED_TEST_EMAIL,
      );
    },
  },
});
