import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-primary hover:underline">
        ← Back to Voyage
      </Link>
      <h1 className="mt-6 text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-muted-foreground">Last updated: June 6, 2026</p>

      <div className="prose prose-neutral mt-8 max-w-none space-y-6 text-foreground">
        <section>
          <h2 className="text-xl font-semibold">Acceptance</h2>
          <p className="mt-2 text-muted-foreground">
            By using Voyage, you agree to these terms. If you do not agree, please do not use
            the service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Service description</h2>
          <p className="mt-2 text-muted-foreground">
            Voyage is a travel planning tool. Flight times, place suggestions, and itineraries
            are provided for convenience and may not always be accurate. Always verify critical
            travel information with official sources.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Your account</h2>
          <p className="mt-2 text-muted-foreground">
            You are responsible for maintaining the security of your account and for all
            activity under it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Limitation of liability</h2>
          <p className="mt-2 text-muted-foreground">
            Voyage is provided &quot;as is&quot; without warranties. We are not liable for missed
            flights, incorrect directions, or any travel disruptions resulting from use of the app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="mt-2 text-muted-foreground">
            For questions about these terms, contact us at support@voyage-app.com.
          </p>
        </section>
      </div>
    </div>
  );
}
