import { Link } from "react-router-dom";

export default function Home() {
  return (
    <main className="space-y-24">
      <section className="rounded-3xl bg-gradient-to-br from-white via-slate-50 to-slate-100 px-6 py-16 shadow-soft md:px-12">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              DisputeShield
            </p>
            <h1 className="text-4xl font-semibold leading-tight text-slate-900 md:text-5xl">
              Bank-ready chargeback packets, generated in minutes.
            </h1>
            <p className="max-w-2xl text-base text-slate-600 md:text-lg">
              DisputeShield turns messy order data into a clean evidence packet
              with timelines, policies, and attachment indexes — entirely in the
              browser so files never leave your machine.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/app"
              className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-soft"
            >
              Generate Evidence Packet
            </Link>
            <a
              href="#how"
              className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700"
            >
              See how it works
            </a>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-sm text-slate-500">
            Screenshot mock (evidence builder preview)
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl space-y-8 px-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold text-slate-900">
              Everything banks expect, ready to send
            </h2>
            <p className="max-w-2xl text-slate-600">
              Built for merchants who want a fast, consistent way to assemble
              dispute evidence without wrestling with templates.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Structured summaries",
                body: "Auto-generate a clean cover page with merchant, order, and amount details.",
              },
              {
                title: "Timeline clarity",
                body: "Drop in key events, normalize wording, and export a ready-to-send timeline CSV.",
              },
              {
                title: "Evidence checklist",
                body: "See which proof categories are present or missing before you submit.",
              },
              {
                title: "Attachment index",
                body: "Bundle screenshots and PDFs with notes and an index for reviewers.",
              },
              {
                title: "Client-side only",
                body: "Everything runs in the browser — no uploads, no storage, no accounts.",
              },
              {
                title: "Reusable packets",
                body: "Export a PDF + ZIP that can be reused across processors or banks.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-slate-900">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how">
        <div className="mx-auto max-w-6xl space-y-10 px-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold text-slate-900">How it works</h2>
            <p className="max-w-2xl text-slate-600">
              A simple three-step flow that keeps you moving fast.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Enter dispute details",
                body: "Add merchant info, amounts, and a quick timeline of events.",
              },
              {
                step: "02",
                title: "Attach proof",
                body: "Drop in local screenshots, tracking scans, and customer messages.",
              },
              {
                step: "03",
                title: "Export & send",
                body: "Download a PDF + ZIP evidence packet ready for the bank.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-6"
              >
                <p className="text-xs font-semibold uppercase text-slate-500">
                  {item.step}
                </p>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl space-y-10 px-6">
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold text-slate-900">
              What banks want
            </h2>
            <p className="max-w-2xl text-slate-600">
              Focus on the evidence reviewers scan first.
            </p>
          </div>
          <ul className="grid gap-4 md:grid-cols-2">
            {[
              "Clear timeline of purchase, fulfillment, and delivery events",
              "Proof of delivery or service fulfillment",
              "Authorization signals like billing address and IP match",
              "Published refund and cancellation policies",
              "Customer communications confirming receipt or use",
            ].map((item) => (
              <li
                key={item}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl space-y-6 rounded-3xl border border-slate-200 bg-white px-6 py-12 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold text-slate-900">
              Privacy by default
            </h2>
            <p className="max-w-2xl text-slate-600">
              DisputeShield generates everything locally in your browser. Files
              never upload to a server, and nothing is stored once you close the
              tab.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              "Client-side PDF + ZIP generation",
              "No accounts, no storage, no tracking files",
              "Works offline once loaded",
            ].map((item) => (
              <div
                key={item}
                className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-5xl space-y-8 px-6">
          <h2 className="text-3xl font-semibold text-slate-900">FAQ</h2>
          <div className="space-y-4">
            {[
              {
                q: "Does DisputeShield store customer data?",
                a: "No. Everything runs in the browser and nothing is uploaded.",
              },
              {
                q: "Can I use this for any dispute reason?",
                a: "Yes. The evidence checklist is flexible across reason codes.",
              },
              {
                q: "Will this work offline?",
                a: "After the app loads, exports run fully client-side.",
              },
            ].map((item) => (
              <div
                key={item.q}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <h3 className="text-base font-semibold text-slate-900">
                  {item.q}
                </h3>
                <p className="mt-2 text-sm text-slate-600">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
