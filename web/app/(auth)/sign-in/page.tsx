import { signIn } from "@/lib/auth/config";

import styles from "./sign-in.module.css";

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error } = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>SCARLET THREAD</p>
        <h1>Your study stays yours.</h1>
        <p className={styles.copy}>
          Sign in with the one Google account authorized for this private
          journal.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            Sign-in was not accepted. Check the authorized account and try
            again.
          </p>
        ) : null}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className={styles.button} type="submit">
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
