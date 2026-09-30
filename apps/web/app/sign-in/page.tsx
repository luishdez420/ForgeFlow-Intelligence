import { signIn } from "../../auth";

export default function SignInPage() {
  const configured = Boolean(
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET &&
    process.env.GOOGLE_WORKSPACE_DOMAIN,
  );

  return (
    <main>
      <section className="launch" aria-labelledby="sign-in-title">
        <div>
          <h1 id="sign-in-title">ForgeFlow Intelligence</h1>
          <p>Sign in with your approved Google Workspace account.</p>
        </div>
        {configured ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button type="submit">Continue with Google</button>
          </form>
        ) : (
          <p className="status" role="status">
            Google Workspace sign-in has not been configured for this
            environment.
          </p>
        )}
      </section>
    </main>
  );
}
