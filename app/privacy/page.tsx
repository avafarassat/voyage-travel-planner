import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-primary hover:underline">
        ← Back to Voyage
      </Link>
      <h1 className="mt-6 text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-muted-foreground">Last updated: June 6, 2026</p>

      <div className="prose prose-neutral mt-8 max-w-none space-y-6 text-foreground">
        <section>
          <h2 className="text-xl font-semibold">What we collect</h2>
          <p className="mt-2 text-muted-foreground">
            When you create an account, we store your email address and name. Trip data you
            enter — including flights, hotels, places, and uploaded boarding passes — is stored
            securely in our database.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">How we use your data</h2>
          <p className="mt-2 text-muted-foreground">
            Your data is used solely to provide the travel planning service. We do not sell
            your personal information to third parties.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Third-party services</h2>
          <p className="mt-2 text-muted-foreground">
            We use Supabase for authentication and data storage, Google Maps Platform for
            maps and place suggestions, and optionally AviationStack for flight status updates.
            Each service has its own privacy policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Shared trips</h2>
          <p className="mt-2 text-muted-foreground">
            When you enable trip sharing, anyone with the link can view your trip details in
            read-only mode. You can disable sharing at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="mt-2 text-muted-foreground">
            For privacy questions, contact us at privacy@voyage-app.com.
          </p>
        </section>
      </div>
    </div>
  );
}
