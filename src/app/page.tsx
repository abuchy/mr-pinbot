export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-xl rounded-3xl border border-black/10 bg-white p-8 sm:p-12">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Anna Buchy’s publishing workspace</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Mr. Pinbot</h1>
        <p className="mt-5 text-lg leading-relaxed text-stone-600">A little organization. A lot of possibility.</p>
        <p className="mt-4 leading-relaxed text-stone-600">Your Pinterest content workspace is taking shape. Soon, you’ll be able to prepare, review, and schedule your Pins here.</p>
        <span className="mt-8 inline-block rounded-full bg-stone-100 px-4 py-2 text-sm text-stone-600">In development</span>
      </section>
    </main>
  );
}
